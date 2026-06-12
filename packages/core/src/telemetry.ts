import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Opt-in local telemetry for the rule-pack incentive flywheel (v0.5.0 phase
// 3): every time `brainblast fix --apply` confirms a RED -> GREEN transition
// for a rule that came from a third-party pack (see src/packs.ts), an event
// is appended to <targetDir>/.agent-research/telemetry.ndjson. This is the
// data source for the future "graduation gate" (a rule becomes
// bounty-eligible once N distinct (repo_hash, user_hash) pairs graduate it).
//
// Off by default. Enabled by either:
//   - env var BRAINBLAST_TELEMETRY=1 (or "true")
//   - <targetDir>/.agent-research/config.json containing { "telemetry": true }
//
// Both repo_hash and user_hash are one-way hashes — no repo URL, file paths,
// or user identifiers are ever written to the event stream.

export interface GraduationEvent {
  pack_id: string;
  rule_id: string;
  repo_hash: string;
  user_hash: string;
  timestamp: string;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function isTelemetryEnabled(targetDir: string): boolean {
  const env = process.env.BRAINBLAST_TELEMETRY;
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;

  const configPath = join(targetDir, ".agent-research", "config.json");
  if (!existsSync(configPath)) return false;
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    return cfg?.telemetry === true;
  } catch {
    return false;
  }
}

// A stable, anonymous per-machine id, persisted at ~/.brainblast/telemetry-id
// (created on first use). Returned as a truncated sha256 hash, never the raw
// id, so the on-disk id can't be reverse-correlated from the event stream.
export function getUserHash(): string {
  const idPath = join(homedir(), ".brainblast", "telemetry-id");
  let id: string;
  if (existsSync(idPath)) {
    id = readFileSync(idPath, "utf8").trim();
  } else {
    id = randomUUID();
    mkdirSync(dirname(idPath), { recursive: true });
    writeFileSync(idPath, id, "utf8");
  }
  return sha256Hex(id).slice(0, 16);
}

// A stable hash identifying the repo: the git remote origin URL if available,
// otherwise the resolved absolute path of `targetDir`.
export function getRepoHash(targetDir: string): string {
  let key = "";
  try {
    key = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // not a git repo, or no origin configured
  }
  if (!key) key = resolve(targetDir);
  return sha256Hex(key).slice(0, 16);
}

export function telemetryFilePath(targetDir: string): string {
  return join(targetDir, ".agent-research", "telemetry.ndjson");
}

// Append one graduation event per `{ pack_id, rule_id }` pair to
// <targetDir>/.agent-research/telemetry.ndjson. No-op if `events` is empty.
export function recordGraduationEvents(
  targetDir: string,
  events: { pack_id: string; rule_id: string }[],
): void {
  if (events.length === 0) return;

  const file = telemetryFilePath(targetDir);
  mkdirSync(dirname(file), { recursive: true });

  const repo_hash = getRepoHash(targetDir);
  const user_hash = getUserHash();
  const timestamp = new Date().toISOString();

  const lines = events
    .map((e) => JSON.stringify({ ...e, repo_hash, user_hash, timestamp } satisfies GraduationEvent))
    .join("\n");
  appendFileSync(file, lines + "\n", "utf8");
}
