// Contributor ingest gate — Stage 2 of ROADMAP-TRAINING-DATA.md.
//
// Turns a *real* fix from a *real* repo into a Verified Trap Instance, under
// three hard gates that make contributed data safe to sell:
//
//   1. SECRET SCAN  — every file is run through Keyguard's classifier; if ANY
//      key/keypair/mnemonic is present, the contribution is REFUSED. We never
//      ingest a secret. (Fail-closed: any detection, any confidence, blocks.)
//   2. REPRODUCTION — the contributed vulnerable/ and fixed/ are re-proven
//      RED→GREEN against the trap's rule (the oracle). Non-reproducing data is
//      rejected; this is the gate $BRAIN stake-slashing keys off (anti-poison).
//   3. CONSENT/LICENSE — accepted records are stamped contributor-grant-v1 with
//      the contributor's consent scope and written to a PHYSICALLY SEPARATE lot,
//      so a consent issue can never contaminate the synthetic-owned corpus.
//
// Pure and fs-reading only — no network, no execution of contributed code (the
// audit pipeline parses with ts-morph; it never runs the candidate).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { auditWithRule } from "../audit.ts";
import { detectFileSecrets } from "../keys/detect.ts";
import { isSafeId } from "../packs.ts";
import { classifyTrap } from "../vtiClass.ts";
import type { CheckResult, Rule } from "../types.ts";

export type ConsentScope = "opt-in:train" | "opt-in:eval" | "opt-in:train+eval";

export interface IngestInput {
  /** Directory containing `vulnerable/` and `fixed/` subdirectories. */
  submissionDir: string;
  /** The bundled rule that proves this trap — the grading oracle. */
  rule: Rule;
  /** What the contributor consented to. */
  consentScope: ConsentScope;
  /** Distinct repos that confirmed this fix, if known. */
  corroborationCount?: number;
  /** Override timestamp (tests). */
  now?: string;
}

export interface SecretHit {
  file: string;
  kind: string;
  confidence: string;
}

export interface IngestResult {
  accepted: boolean;
  trapId: string;
  reasons: string[];
  secretsFound: SecretHit[];
  proof: { red: boolean; green: boolean };
  vti?: Record<string, unknown>;
}

// Files worth scanning/reading inside a submission dir (recursive).
function listFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function scanForSecrets(dir: string, relTo: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const f of listFiles(dir)) {
    let content: string;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const d of detectFileSecrets(content)) {
      hits.push({ file: f.slice(relTo.length + 1), kind: d.kind, confidence: d.confidence });
    }
  }
  return hits;
}

function firstFail(checks: CheckResult[]): CheckResult | undefined {
  return checks.find((c) => c.result === "fail");
}

function snippetFor(check: CheckResult | undefined, dir: string, relTo: string): { path: string; snippet: string } {
  let file = check?.file;
  if (!file || !existsSync(file)) {
    const first = listFiles(dir)[0];
    file = first ?? "";
  }
  return { path: file ? file.slice(relTo.length + 1) : "", snippet: file ? readFileSync(file, "utf8") : "" };
}

export function ingestContribution(input: IngestInput): IngestResult {
  const { rule, submissionDir, consentScope } = input;
  // Relativize all paths to the submission dir — never embed the contributor's
  // absolute filesystem path (itself an info leak) in a record or report.
  const relBase = submissionDir;
  const trapId = rule.id;
  const reasons: string[] = [];
  const now = input.now ?? new Date().toISOString();

  const reject = (): IngestResult => ({ accepted: false, trapId, reasons, secretsFound, proof });
  let secretsFound: SecretHit[] = [];
  let proof = { red: false, green: false };

  // Gate 0 — id must be a safe path segment (we build fixtures/<trapId>/ paths).
  if (!isSafeId(trapId)) {
    reasons.push(`unsafe trap id ${JSON.stringify(trapId)}`);
    return reject();
  }

  const vulnDir = join(submissionDir, "vulnerable");
  const fixedDir = join(submissionDir, "fixed");
  if (!existsSync(vulnDir) || !existsSync(fixedDir)) {
    reasons.push("submission must contain vulnerable/ and fixed/ directories");
    return reject();
  }

  // Gate 1 — never ingest a secret. Fail-closed on any detection.
  secretsFound = [...scanForSecrets(vulnDir, relBase), ...scanForSecrets(fixedDir, relBase)];
  if (secretsFound.length > 0) {
    reasons.push(`refusing to ingest: ${secretsFound.length} secret(s) detected (${secretsFound.map((s) => s.kind).join(", ")})`);
    return reject();
  }

  // Gate 2 — reproduce RED→GREEN against the oracle (anti-poisoning).
  const redChecks = auditWithRule(vulnDir, rule);
  const fixedChecks = auditWithRule(fixedDir, rule);
  const red = redChecks.some((c) => c.result === "fail");
  const green = !fixedChecks.some((c) => c.result === "fail");
  proof = { red, green };
  if (!red) reasons.push("vulnerable/ did not trip the trap — RED not reproduced");
  if (!green) reasons.push("fixed/ still trips the trap — GREEN not reproduced");
  if (reasons.length) return reject();

  // Accepted — stamp a contributor-licensed VTI (separate lot).
  const lang = (rule.detect.lang ?? "typescript") as "typescript" | "rust" | "config";
  const vulnTarget = firstFail(redChecks);
  const fixedTarget = fixedChecks[0];
  const vuln = snippetFor(vulnTarget, vulnDir, relBase);
  const fixed = snippetFor(fixedTarget, fixedDir, relBase);

  const vti = {
    schemaVersion: "1.0",
    trapId,
    title: rule.title,
    sdk: { name: rule.component.name, version: rule.component.version ?? null, type: rule.component.type ?? null },
    severity: rule.severity,
    class: classifyTrap(rule),
    vulnerable: { lang, path: vuln.path, snippet: vuln.snippet, detail: vulnTarget?.detail ?? null },
    fixed: { lang, path: fixed.path, snippet: fixed.snippet, detail: fixedTarget?.detail ?? null },
    generatedTest: null,
    redGreenProof: { red, green, method: "static-checker", checkKind: rule.check?.kind ?? null, verifiedAt: now },
    provenance: {
      sourceUrls: rule.component.sourceUrl ? [rule.component.sourceUrl] : [],
      pack: rule.pack ?? null,
      exploit: rule.exploit ?? null,
      generator: "ingest-vti@0.1.0",
    },
    corroborationCount: input.corroborationCount ?? 1,
    license: "contributor-grant-v1",
    consentScope,
    capturedAt: now,
  };

  return { accepted: true, trapId, reasons: [], secretsFound: [], proof, vti };
}

// Re-prove a snippet pair against a rule: RED on the vulnerable side, GREEN on
// the fixed side. The integrity primitive behind the corpus SLA monitor — given
// a stored VTI, does its trap still reproduce? Code is parsed, never executed.
export function reproducePair(
  rule: Rule,
  vulnerableSource: string,
  fixedSource: string,
  fileName = "candidate.ts",
): { red: boolean; green: boolean } {
  const base = mkdtempSync(join(tmpdir(), "bb-repro-"));
  try {
    const fname = basename(fileName) || "candidate.ts";
    mkdirSync(join(base, "vulnerable"), { recursive: true });
    mkdirSync(join(base, "fixed"), { recursive: true });
    writeFileSync(join(base, "vulnerable", fname), vulnerableSource);
    writeFileSync(join(base, "fixed", fname), fixedSource);
    const red = auditWithRule(join(base, "vulnerable"), rule).some((c) => c.result === "fail");
    const green = !auditWithRule(join(base, "fixed"), rule).some((c) => c.result === "fail");
    return { red, green };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// Ingest a captured before/after pair (snippets, not a directory). Materializes
// the pair into a temp vulnerable/ + fixed/ layout, runs the same three gates,
// and cleans up. Used to drain telemetry-captured contributions (capture.ts).
export function ingestCandidate(
  input: {
    rule: Rule;
    file?: string;
    vulnerableSource: string;
    fixedSource: string;
    consentScope: ConsentScope;
    corroborationCount?: number;
    now?: string;
  },
): IngestResult {
  const base = mkdtempSync(join(tmpdir(), "bb-ingest-"));
  try {
    const fname = input.file ? basename(input.file) || "candidate.ts" : "candidate.ts";
    mkdirSync(join(base, "vulnerable"), { recursive: true });
    mkdirSync(join(base, "fixed"), { recursive: true });
    writeFileSync(join(base, "vulnerable", fname), input.vulnerableSource);
    writeFileSync(join(base, "fixed", fname), input.fixedSource);
    return ingestContribution({
      submissionDir: base,
      rule: input.rule,
      consentScope: input.consentScope,
      corroborationCount: input.corroborationCount,
      now: input.now,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
