// Consent-gated contribution capture — Stage 2, Step 1 of ROADMAP-TRAINING-DATA.md.
//
// The PRODUCER for the ingest gate. Today's telemetry records a one-way-HASHED
// event on every confirmed RED→GREEN fix (telemetry.ts). This adds a separate,
// explicitly-opted-in path that captures the actual before/after CONTENT so a
// real fix can become a Verified Trap Instance.
//
//   - OFF by default. Enabled ONLY by BRAINBLAST_CONTRIBUTE=1 or
//     .agent-research/config.json { "contribute": { "enabled": true } }.
//     Non-consenting users are completely unaffected; hash-only telemetry is
//     unchanged.
//   - Content is staged locally to .agent-research/contrib-staging/ and goes
//     nowhere until it passes the ingest gate (secret-scan + reproduce + license).
//   - SECRET PRE-SCAN: a captured pair is refused (never written to disk) if any
//     key/keypair/mnemonic is present — defense in depth on top of the gate.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectFileSecrets } from "../keys/detect.ts";
import type { ConsentScope } from "./ingest.ts";

const VALID_CONSENT: ConsentScope[] = ["opt-in:train", "opt-in:eval", "opt-in:train+eval"];
const DEFAULT_CONSENT: ConsentScope = "opt-in:train+eval";

function readConfig(targetDir: string): any {
  try {
    return JSON.parse(readFileSync(join(targetDir, ".agent-research", "config.json"), "utf8"));
  } catch {
    return null;
  }
}

// Separate, explicit opt-in — independent of (and stricter than) hash-only
// telemetry. Env wins over config; default is OFF.
export function isContributeEnabled(targetDir: string): boolean {
  const env = process.env.BRAINBLAST_CONTRIBUTE;
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  const c = readConfig(targetDir)?.contribute;
  if (c === true) return true;
  if (c && typeof c === "object") return c.enabled === true;
  return false;
}

export function contributeConsentScope(targetDir: string): ConsentScope {
  const s = readConfig(targetDir)?.contribute?.consentScope;
  return VALID_CONSENT.includes(s) ? s : DEFAULT_CONSENT;
}

export function contribStagingDir(targetDir: string): string {
  return join(targetDir, ".agent-research", "contrib-staging");
}

export interface StagedContribution {
  schemaVersion: "1.0";
  ruleId: string;
  file: string; // relative path, for context only — never an absolute path
  vulnerable: string;
  fixed: string;
  consentScope: ConsentScope;
  capturedAt: string;
}

export interface StageResult {
  staged: boolean;
  path?: string;
  reason?: string;
}

// Stage one captured before/after pair. No-op unless contribute is enabled.
// Refuses (without writing) if either side contains a secret.
export function stageContribution(
  targetDir: string,
  c: { ruleId: string; file: string; vulnerable: string; fixed: string },
  now = new Date().toISOString(),
): StageResult {
  if (!isContributeEnabled(targetDir)) return { staged: false, reason: "contribute disabled" };

  const secrets = [...detectFileSecrets(c.vulnerable), ...detectFileSecrets(c.fixed)];
  if (secrets.length > 0) {
    return { staged: false, reason: `secret(s) detected (${secrets.map((s) => s.kind).join(", ")}); not staged` };
  }

  const dir = contribStagingDir(targetDir);
  mkdirSync(dir, { recursive: true });
  const rec: StagedContribution = {
    schemaVersion: "1.0",
    ruleId: c.ruleId,
    file: c.file,
    vulnerable: c.vulnerable,
    fixed: c.fixed,
    consentScope: contributeConsentScope(targetDir),
    capturedAt: now,
  };
  const id = createHash("sha256").update(`${c.ruleId}\0${c.vulnerable}\0${c.fixed}`).digest("hex").slice(0, 16);
  const path = join(dir, `${c.ruleId}-${id}.json`);
  writeFileSync(path, JSON.stringify(rec, null, 2) + "\n");
  return { staged: true, path };
}

export function listStagedContributions(targetDir: string): { path: string; rec: StagedContribution }[] {
  const dir = contribStagingDir(targetDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const path = join(dir, f);
      return { path, rec: JSON.parse(readFileSync(path, "utf8")) as StagedContribution };
    });
}
