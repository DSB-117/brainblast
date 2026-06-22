// Keyguard — the Guard: intercept a destructive operation BEFORE it lands.
//
// The firewall decodes a transaction into its real instructions before an agent
// signs; the Guard decodes a destructive shell command into the real set of
// files it would destroy before an agent runs it. If that blast set intersects
// an irreplaceable secret, we block — and hand back the safe alternative.
//
// The clever part is precision: we don't string-match "git clean -fdx", we run
// its own dry-run to get the exact file list, and we expand `rm -rf dir/` by
// walking the directory. So the verdict is measured, not guessed.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { detectFileSecrets } from "./detect.ts";
import { deriveTier } from "./scan.ts";
import type { BlastTier, SecretKind } from "./types.ts";

const MAX_BYTES = 64 * 1024;
const MAX_WALK = 20_000;
const WALK_SKIP = new Set(["node_modules", ".git", ".next", ".brainblast"]);

export type GuardDecision = "allow" | "warn" | "block";

export interface GuardFinding {
  path: string;
  rel: string;
  kind: SecretKind;
  tier: BlastTier;
  vaulted: boolean;
}

export interface GuardVerdict {
  decision: GuardDecision;
  command: string;
  findings: GuardFinding[];
  imprecise: boolean; // we couldn't fully expand the blast set
  message: string;
  safeAlternative?: string;
}

export interface GuardOpts {
  cwd?: string;
  vaultLookup?: (absPath: string) => boolean;
}

// ── shell tokenizer (quote-aware, deliberately small) ────────────────────────
function tokenize(segment: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function resolveTarget(p: string, cwd: string): string {
  const e = expandHome(p);
  return isAbsolute(e) ? e : resolve(cwd, e);
}

function walkFiles(dir: string, out: string[]): void {
  if (out.length >= MAX_WALK) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_WALK) return;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (WALK_SKIP.has(e)) continue;
      walkFiles(p, out);
    } else if (st.isFile()) {
      out.push(p);
    }
  }
}

function addPath(p: string, files: Set<string>): void {
  let st;
  try {
    st = statSync(p);
  } catch {
    return; // doesn't exist → nothing to destroy
  }
  if (st.isDirectory()) {
    const sub: string[] = [];
    walkFiles(p, sub);
    for (const f of sub) files.add(f);
  } else if (st.isFile()) {
    files.add(p);
  }
}

interface BlastSet {
  files: Set<string>;
  ops: string[];
  imprecise: boolean;
}

function gitCleanDryRun(cleanArgs: string[], cwd: string, files: Set<string>): boolean {
  try {
    // Append -n so it only PRINTS what `-f` would remove. Their other flags
    // (-d, -x, -X, pathspecs) are preserved, so the list is exact.
    const out = execFileSync("git", ["-C", cwd, "clean", ...cleanArgs, "-n"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^Would remove (.+)$/);
      if (!m) continue;
      const p = resolveTarget(m[1].replace(/\/$/, ""), cwd);
      addPath(p, files);
    }
    return true;
  } catch {
    return false;
  }
}

function computeBlastSet(command: string, cwd0: string): BlastSet {
  const files = new Set<string>();
  const ops: string[] = [];
  let imprecise = false;
  let cwd = cwd0;

  const segments = command.split(/&&|\|\||;|\n|\|/);
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) continue;
    let tokens = tokenize(seg);
    // strip leading VAR=val env assignments
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);
    if (tokens.length === 0) continue;
    const op = tokens[0];
    const rest = tokens.slice(1);
    const nonFlags = rest.filter((t) => !t.startsWith("-"));
    const hasGlob = nonFlags.some((t) => /[*?\[]/.test(t));

    // Track `cd` so later segments resolve correctly.
    if (op === "cd" && nonFlags[0]) {
      cwd = resolveTarget(nonFlags[0], cwd);
      continue;
    }

    if (op === "rm") {
      ops.push("rm");
      if (hasGlob) imprecise = true;
      for (const t of nonFlags) {
        if (/[*?\[]/.test(t)) continue;
        addPath(resolveTarget(t, cwd), files);
      }
    } else if (op === "shred" || op === "truncate") {
      ops.push(op);
      for (const t of nonFlags) addPath(resolveTarget(t, cwd), files);
    } else if (op === "dd") {
      ops.push("dd");
      for (const t of rest) {
        const m = t.match(/^of=(.+)$/);
        if (m) addPath(resolveTarget(m[1], cwd), files);
      }
    } else if (op === "mv" || op === "cp") {
      ops.push(op);
      if (nonFlags.length >= 2) addPath(resolveTarget(nonFlags[nonFlags.length - 1], cwd), files);
    } else if (op === "git" && rest[0] === "clean") {
      ops.push("git clean");
      const ok = gitCleanDryRun(rest.slice(1), cwd, files);
      if (!ok) imprecise = true;
    } else if (op === "find" && rest.includes("-delete")) {
      ops.push("find -delete");
      imprecise = true;
    }

    // Output redirection that truncates a file: `> file` (not >>, not 2>).
    const redir = seg.match(/(?<![>0-9])>(?!>)\s*("[^"]+"|'[^']+'|\S+)/);
    if (redir) {
      ops.push("redirect >");
      const target = redir[1].replace(/^['"]|['"]$/g, "");
      addPath(resolveTarget(target, cwd), files);
    }
  }

  return { files, ops, imprecise };
}

function detectInFiles(paths: Iterable<string>, scanRoot: string, vaultLookup?: (p: string) => boolean): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const path of paths) {
    let buf: Buffer;
    try {
      const st = statSync(path);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = readFileSync(path);
    } catch {
      continue;
    }
    // skip binary
    let bin = false;
    for (let i = 0; i < Math.min(buf.length, 1024); i++) if (buf[i] === 0) { bin = true; break; }
    if (bin) continue;

    const rel = relative(scanRoot, path);
    for (const d of detectFileSecrets(buf.toString("utf8"))) {
      const { tier } = deriveTier(d, rel);
      findings.push({ path, rel, kind: d.kind, tier, vaulted: vaultLookup ? vaultLookup(path) : false });
    }
  }
  return findings;
}

const TIER_RANK: Record<BlastTier, number> = { terminal: 0, funds: 1, unknown: 2, rebuildable: 3, trivial: 4 };

export function evaluateCommand(command: string, opts: GuardOpts = {}): GuardVerdict {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const blast = computeBlastSet(command, cwd);

  let findings = detectInFiles(blast.files, cwd, opts.vaultLookup);

  // If we couldn't expand the command precisely (a glob, find -delete), fall
  // back to scanning the working dir so we don't wave through a real risk.
  if (blast.imprecise && findings.length === 0) {
    const sub: string[] = [];
    walkFiles(cwd, sub);
    findings = detectInFiles(sub, cwd, opts.vaultLookup);
  }

  return verdictFrom(command, findings, blast);
}

// Overwriting a file (Write/Edit tool, or `cp`/`mv` onto it) — evaluate a single
// destination path.
export function evaluateOverwrite(filePath: string, opts: GuardOpts = {}): GuardVerdict {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const abs = resolveTarget(filePath, cwd);
  const findings = existsSync(abs) ? detectInFiles([abs], cwd, opts.vaultLookup) : [];
  return verdictFrom(`overwrite ${filePath}`, findings, { files: new Set([abs]), ops: ["overwrite"], imprecise: false });
}

function verdictFrom(command: string, findings: GuardFinding[], blast: BlastSet): GuardVerdict {
  findings.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  const highUnvaulted = findings.filter((f) => (f.tier === "terminal" || f.tier === "funds") && !f.vaulted);
  const highVaulted = findings.filter((f) => (f.tier === "terminal" || f.tier === "funds") && f.vaulted);
  const lower = findings.filter((f) => f.tier === "unknown" || f.tier === "rebuildable");

  let decision: GuardDecision = "allow";
  if (highUnvaulted.length) decision = "block";
  else if (highVaulted.length || lower.length) decision = "warn";

  const opLabel = blast.ops[0] ?? "this command";
  let message: string;
  let safeAlternative: string | undefined;

  if (decision === "block") {
    const lines = highUnvaulted.map(
      (f) => `  ☠ ${f.rel} — irreplaceable Solana secret (${f.kind}); not in the Vault, git can't restore it`,
    );
    message =
      `BLOCKED — \`${opLabel}\` would permanently destroy ${highUnvaulted.length} irreplaceable secret(s):\n` +
      lines.join("\n");
    safeAlternative =
      `Back them up first, then re-run:  brainblast vault backup ${highUnvaulted.map((f) => f.rel).join(" ")}\n` +
      `  or soft-delete safely:  brainblast vault trash <file>` +
      (blast.ops.includes("git clean") ? `\n  or exclude them:  git clean … --exclude='*.json' --exclude='.env'` : "");
  } else if (decision === "warn") {
    const all = [...highVaulted, ...lower];
    message =
      `CAUTION — \`${opLabel}\` touches ${all.length} secret(s):\n` +
      all
        .map((f) => `  ${f.vaulted ? "·" : "⚠"} ${f.rel} (${f.tier})${f.vaulted ? " — recoverable from the Vault" : ""}`)
        .join("\n") +
      (blast.imprecise ? "\n  (command couldn't be expanded precisely — verify before running)" : "");
    safeAlternative = highVaulted.length ? undefined : `brainblast vault backup <file> before proceeding`;
  } else {
    message = `OK — \`${command}\` does not touch any detected irreplaceable secret.`;
  }

  return { decision, command, findings, imprecise: blast.imprecise, message, safeAlternative };
}
