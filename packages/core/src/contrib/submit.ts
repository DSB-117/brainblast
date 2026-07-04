// Direct submission gate — the git-less on-ramp for VTIs.
//
// PRs don't scale: at hundreds of contributions a day, a human can't review a
// pull request per submission. This module is the server-side validator that
// makes a direct-to-database write SAFE — the same three gates the file/PR
// intake enforces (`src/contrib/ingest.ts`), wrapped so an HTTP endpoint can run
// them on an untrusted, single-shot Finding payload:
//
//   0. SHAPE      — the payload is validated hard (untrusted input): required
//      fields, a vetted `check.kind`, a safe id, size caps. Malformed → rejected
//      BEFORE anything is staged or proven.
//   1. SECRET SCAN — the fixtures are run through Keyguard; any key/keypair/
//      mnemonic refuses the whole submission (via ingestCandidate).
//   2. REPRODUCTION — the vulnerable/fixed pair is re-proven RED→GREEN under the
//      HARDENED "ingest" sandbox (contributor code never runs under light
//      isolation). Non-reproducing → rejected.
//   3. CONSENT     — accepted records are stamped `contributor-grant-v1` + the
//      contributor's consent scope, in the physically-separate contributor lot.
//
// Pure and dependency-free of the transport: it takes a parsed object and returns
// a verdict. The registry server (off-repo, holds the DB key) imports this and,
// on `accepted`, inserts `result.vti` into its store — see `scripts/registry-
// server.ts` for a runnable reference. This is the seam that turns "open a PR"
// into "POST /api/vti".

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkerKinds } from "../checkers/index.ts";
import { testKinds } from "../testTemplates/index.ts";
import { isSafeId } from "../packs.ts";
import { loadRules } from "../loadRules.ts";
import { stageFinding } from "../synth/synthesize.ts";
import { ingestCandidate, type ConsentScope, type SecretHit } from "./ingest.ts";
import type { Finding } from "../synth/types.ts";

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const CONSENT_SCOPES = new Set<ConsentScope>(["opt-in:train", "opt-in:eval", "opt-in:train+eval"]);
// Caps so a single POST can't wedge the prover. Fixtures are meant to be small,
// self-contained repros; anything larger is almost certainly not a clean trap.
const MAX_FIXTURE_BYTES = 64 * 1024;

export interface SubmitResult {
  accepted: boolean;
  status: "accepted" | "rejected";
  trapId: string | null;
  reasons: string[];
  proof?: { red: boolean; green: boolean };
  method?: string;
  secretsFound?: SecretHit[];
  /** The minted, contributor-licensed VTI — insert THIS into the store when accepted. */
  vti?: Record<string, unknown>;
}

export interface SubmitOptions {
  consentScope?: ConsentScope;
  corroborationCount?: number;
  now?: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Gate 0 — validate an untrusted payload is a well-formed Finding whose binding
// resolves to vetted templates. Returns human-readable reasons; empty = valid.
// This runs BEFORE staging so a hostile/huge/garbage body is cheap to reject.
export function validateSubmission(x: unknown): string[] {
  const reasons: string[] = [];
  if (typeof x !== "object" || x === null) return ["submission must be a JSON object"];
  const f = x as Record<string, any>;

  if (!isNonEmptyString(f.id)) reasons.push("id must be a non-empty string");
  else if (!isSafeId(f.id)) reasons.push(`id ${JSON.stringify(f.id)} is not a safe path segment`);

  if (!isNonEmptyString(f.severity) || !SEVERITIES.has(f.severity)) {
    reasons.push("severity must be one of critical|high|medium|low");
  }
  if (!isNonEmptyString(f.title)) reasons.push("title must be a non-empty string");

  if (typeof f.component !== "object" || f.component === null || !isNonEmptyString(f.component.name)) {
    reasons.push("component.name must be a non-empty string");
  }

  const d = f.detect;
  if (typeof d !== "object" || d === null || !Array.isArray(d.modules) || !isNonEmptyString(d.nameRegex) || !Array.isArray(d.triggerCalls)) {
    reasons.push("detect must have { modules: string[], nameRegex: string, triggerCalls: string[] }");
  }

  const check = f.binding?.check;
  const test = f.binding?.test;
  if (typeof check !== "object" || check === null || !isNonEmptyString(check.kind)) {
    reasons.push("binding.check.kind is required");
  } else if (!checkerKinds.includes(check.kind)) {
    // Fail CLOSED on an unvetted checker — exactly like the proof gate. A new
    // shape needs a checker proposal (fleet/checker-proposals), not an open POST.
    reasons.push(`binding.check.kind '${check.kind}' is not a vetted checker`);
  }
  if (typeof test !== "object" || test === null || !isNonEmptyString(test.kind)) {
    reasons.push("binding.test.kind is required (use \"none\" for a static-shape trap)");
  } else if (!testKinds.includes(test.kind)) {
    reasons.push(`binding.test.kind '${test.kind}' is not a vetted test`);
  }

  const fx = f.fixtures;
  if (typeof fx !== "object" || fx === null) {
    reasons.push("fixtures must be { filename, vulnerable, fixed }");
  } else {
    if (!isNonEmptyString(fx.filename)) reasons.push("fixtures.filename must be a non-empty string");
    if (!isNonEmptyString(fx.vulnerable)) reasons.push("fixtures.vulnerable must be non-empty source");
    if (!isNonEmptyString(fx.fixed)) reasons.push("fixtures.fixed must be non-empty source");
    const vBytes = Buffer.byteLength(String(fx.vulnerable ?? ""), "utf8");
    const fBytes = Buffer.byteLength(String(fx.fixed ?? ""), "utf8");
    if (vBytes > MAX_FIXTURE_BYTES || fBytes > MAX_FIXTURE_BYTES) {
      reasons.push(`fixtures too large (max ${MAX_FIXTURE_BYTES} bytes each)`);
    }
  }

  return reasons;
}

// The one call the registry server makes. Validate → stage Finding into a Rule →
// run the secret + RED→GREEN + consent gates → return a verdict (and, when
// accepted, the minted VTI to insert). Never throws on bad input; hostile
// payloads come back as `rejected` with reasons.
export async function ingestSubmission(raw: unknown, opts: SubmitOptions = {}): Promise<SubmitResult> {
  const trapId = typeof (raw as any)?.id === "string" ? (raw as any).id : null;

  const shapeReasons = validateSubmission(raw);
  if (shapeReasons.length > 0) {
    return { accepted: false, status: "rejected", trapId, reasons: shapeReasons };
  }

  const finding = raw as Finding;
  const consentScope = opts.consentScope ?? "opt-in:train+eval";
  if (!CONSENT_SCOPES.has(consentScope)) {
    return { accepted: false, status: "rejected", trapId, reasons: [`invalid consentScope ${JSON.stringify(consentScope)}`] };
  }

  // Convert the Finding into a loadable Rule via the canonical staging path
  // (identical to proveFinding), so there is no second rule-shape to drift.
  const stageRoot = mkdtempSync(join(tmpdir(), "bb-submit-"));
  try {
    stageFinding(stageRoot, finding);
    let rules;
    try {
      rules = loadRules(join(stageRoot, finding.id, "rules"));
    } catch (e: any) {
      return { accepted: false, status: "rejected", trapId, reasons: [`rule failed to load: ${e?.message ?? e}`] };
    }
    const rule = rules.find((r) => r.id === finding.id) ?? rules[0];
    if (!rule) {
      return { accepted: false, status: "rejected", trapId, reasons: ["no rule loaded from the submission"] };
    }

    // Gates 1–3 — secret scan + RED→GREEN (hardened "ingest" sandbox) + consent
    // stamp + VTI mint, all inside ingestCandidate/ingestContribution.
    const res = await ingestCandidate({
      rule,
      file: finding.fixtures.filename,
      vulnerableSource: finding.fixtures.vulnerable,
      fixedSource: finding.fixtures.fixed,
      consentScope,
      corroborationCount: opts.corroborationCount,
      now: opts.now,
    });

    return {
      accepted: res.accepted,
      status: res.accepted ? "accepted" : "rejected",
      trapId: res.trapId,
      reasons: res.reasons,
      proof: res.proof,
      method: res.method,
      secretsFound: res.secretsFound,
      vti: res.vti,
    };
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}
