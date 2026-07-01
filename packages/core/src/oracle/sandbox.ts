import { spawnSync } from "node:child_process";
import { readdirSync, mkdirSync, mkdtempSync, copyFileSync, statSync, chmodSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { OracleContext } from "./types.ts";

// ── The context-scaled sandbox (v0.9.1) ───────────────────────────────────────
//
// Tier-2 backends RUN candidate code. That is a security question, and the risk
// depends entirely on WHOSE code and WHERE (see V0.9.0-PLAN.md, "Two properties"):
//
//   context "local"  — the user's OWN code on their OWN machine. They already run
//     it constantly; we add a light isolate (child process + hard wall-clock
//     timeout + output cap) so a runaway test can't hang the machine. This is a
//     convenience guard, NOT a defense against malice — there's no untrusted party.
//
//   context "ingest" — a CONTRIBUTOR's code on OUR infra, to mint a sellable
//     record. This is the real attack surface, so the bar is categorically higher
//     and non-negotiable: a hardened container (--network=none, read-only, dropped
//     caps, non-root, memory/CPU/pid limits). If that container cannot be stood up,
//     the sandbox REFUSES (status "refused") rather than ever running contributor
//     code unprotected. The light isolate is NEVER accepted for "ingest".
//
// The interface is uniform; the isolation strength is a function of trust, and
// trust is a function of whose code and where — not a single global switch.

export type SandboxStatus =
  | "ok" // ran to completion (exitCode meaningful)
  | "timeout" // killed by the wall-clock guard
  | "refused" // hardened sandbox required (ingest) but unavailable — never ran
  | "error"; // could not run for another reason

export interface SandboxResult {
  status: SandboxStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  isolation: "light" | "hardened";
  detail?: string;
}

export interface SandboxSpec {
  /** Ephemeral working dir, already populated with the candidate + test/harness. */
  dir: string;
  /** Executable to run inside the sandbox (e.g. "node", "npx"). */
  command: string;
  args: string[];
  /** Selects isolation strength: "local" → light, "ingest" → hardened (enforced). */
  context: OracleContext;
  /** Wall-clock budget; the process is killed past it and scored timeout. */
  timeoutMs?: number;
  /** Output is truncated past this many bytes (a fork/print bomb can't flood us). */
  maxOutputBytes?: number;
  /** Container image for the hardened path (must be pre-pulled; --network=none). */
  image?: string;
  /**
   * Extra read-only host paths to mount into the hardened container at the same
   * path (e.g. a node_modules dir so the test runner resolves deps offline).
   */
  readonlyMounts?: string[];
}

// The package root (packages/core). Ephemeral sandbox dirs live UNDER it so the
// test runner / tsx and the pinned deps (vitest, stripe, …) resolve by ordinary
// node module walk-up — the same trick the compiler backend uses.
export function packageRoot(): string {
  // this file: <pkg>/src/oracle/sandbox.ts  →  up 2 dirs (oracle, src) = <pkg>
  return fileURLToPath(new URL("../../", import.meta.url));
}

// Create an ephemeral sandbox dir under the package root.
export function makeSandboxDir(prefix = ".oracle-sbx-"): string {
  return mkdtempSync(join(packageRoot(), prefix));
}

// Copy the candidate's sources into the sandbox, preserving structure. Skips
// node_modules, dotfiles, and .d.ts. `ext` selects which files to copy — default
// is the TS/JS set; a language backend (e.g. Python) passes its own. Returns the
// copied file paths.
export function copyCandidate(
  srcDir: string,
  destDir: string,
  ext: RegExp = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/,
): string[] {
  const copied: string[] = [];
  const walk = (cur: string) => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const abs = join(cur, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (ext.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const dest = join(destDir, relative(srcDir, abs));
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(abs, dest);
        copied.push(dest);
      }
    }
  };
  if (statSync(srcDir).isDirectory()) walk(srcDir);
  return copied;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT = 1_000_000;
const DEFAULT_IMAGE = "node:22-alpine";

// Detect a usable container runtime WITH a live daemon. Cheap; no candidate code.
// Returns the runtime binary name, or null if none is usable (→ ingest refuses).
export function containerRuntime(): "docker" | "podman" | null {
  for (const rt of ["docker", "podman"] as const) {
    const r = spawnSync(rt, ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (!r.error && r.status === 0) return rt;
  }
  return null;
}

// A minimal env for the light isolate: keep PATH (to find node/npx) but drop
// inherited proxy/credential noise so a local run is as reproducible as possible.
function lightEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_OPTIONS: "",
    // Mark that we are inside the oracle sandbox (templates/harnesses can branch).
    BRAINBLAST_SANDBOX: "1",
  };
}

function clamp(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + `\n…[truncated at ${max} bytes]` : s;
}

// Make a tree world-readable (files 0644, dirs 0755) so a non-root container user
// can read a host-owned mkdtemp dir (default 0700). Best-effort; ignores errors.
function makeWorldReadable(root: string): void {
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    try {
      chmodSync(p, st.isDirectory() ? 0o755 : 0o644);
    } catch {
      /* best-effort */
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e));
    }
  };
  walk(root);
}

function isTimeout(r: ReturnType<typeof spawnSync>): boolean {
  // ONLY the wall-clock guard counts as a timeout. A maxBuffer overflow is
  // ENOBUFS (and also kills the child) — that is an output-cap "error", not a
  // timeout, so we must not conflate them.
  const e = r.error as (Error & { code?: string }) | undefined;
  return e?.code === "ETIMEDOUT";
}

// Run a command in the sandbox. Synchronous (spawnSync) by design: deterministic,
// and it lets sync callers (like the offline prove gate) stay sync.
export function runInSandbox(spec: SandboxSpec): SandboxResult {
  const t0 = Date.now();
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOut = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  if (spec.context === "ingest") {
    return runHardened(spec, timeoutMs, maxOut, t0);
  }
  return runLight(spec, timeoutMs, maxOut, t0);
}

// LIGHT ISOLATE — context "local". Child process, hard timeout, output cap, a
// trimmed env. Not a malice defense; it stops a runaway test on the user's OWN
// code. We deliberately do NOT claim network isolation here.
function runLight(spec: SandboxSpec, timeoutMs: number, maxOut: number, t0: number): SandboxResult {
  const r = spawnSync(spec.command, spec.args, {
    cwd: spec.dir,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: maxOut,
    encoding: "utf8",
    env: lightEnv(),
  });
  const durationMs = Date.now() - t0;
  if (isTimeout(r)) {
    return { status: "timeout", exitCode: null, stdout: clamp(r.stdout, maxOut), stderr: clamp(r.stderr, maxOut), durationMs, isolation: "light", detail: `killed after ${timeoutMs}ms` };
  }
  if (r.error) {
    return { status: "error", exitCode: null, stdout: clamp(r.stdout, maxOut), stderr: clamp(r.stderr, maxOut), durationMs, isolation: "light", detail: r.error.message };
  }
  return { status: "ok", exitCode: r.status, stdout: clamp(r.stdout, maxOut), stderr: clamp(r.stderr, maxOut), durationMs, isolation: "light" };
}

// HARDENED CONTAINER — context "ingest". REQUIRED and enforced. If no container
// runtime/daemon is available, we REFUSE (never fall back to the light isolate),
// so contributor code is never run unprotected on our infra.
function runHardened(spec: SandboxSpec, timeoutMs: number, maxOut: number, t0: number): SandboxResult {
  const rt = containerRuntime();
  if (!rt) {
    return {
      status: "refused",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - t0,
      isolation: "hardened",
      detail:
        "ingest requires the hardened container sandbox, but no container runtime/daemon is available. " +
        "Refusing to run contributor code in a weaker isolate.",
    };
  }
  const image = spec.image ?? DEFAULT_IMAGE;
  // The container runs as non-root (--user nobody, uid 65534), which won't match
  // the host uid that owns the 0700 mkdtemp dir — so make the mounted tree world-
  // readable (and dirs traversable) first. The contents are the candidate code we
  // are about to run anyway; there is nothing secret to protect with mode bits here.
  makeWorldReadable(spec.dir);
  const mounts = ["-v", `${spec.dir}:/work:ro`];
  for (const m of spec.readonlyMounts ?? []) mounts.push("-v", `${m}:${m}:ro`);
  const args = [
    "run",
    "--rm",
    "--network=none",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--memory=512m",
    "--cpus=1",
    "--pids-limit=256",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user",
    "nobody",
    ...mounts,
    "-w",
    "/work",
    image,
    spec.command,
    ...spec.args,
  ];
  const r = spawnSync(rt, args, { timeout: timeoutMs + 10_000, killSignal: "SIGKILL", maxBuffer: maxOut, encoding: "utf8" });
  const durationMs = Date.now() - t0;
  if (isTimeout(r)) {
    return { status: "timeout", exitCode: null, stdout: clamp(r.stdout, maxOut), stderr: clamp(r.stderr, maxOut), durationMs, isolation: "hardened", detail: `container killed after ${timeoutMs}ms` };
  }
  if (r.error) {
    return { status: "error", exitCode: null, stdout: clamp(r.stdout, maxOut), stderr: clamp(r.stderr, maxOut), durationMs, isolation: "hardened", detail: r.error.message };
  }
  return { status: "ok", exitCode: r.status, stdout: clamp(r.stdout, maxOut), stderr: clamp(r.stderr, maxOut), durationMs, isolation: "hardened" };
}
