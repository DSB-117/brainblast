import type { Rule } from "../types.ts";

// ── The Generalized Oracle (v0.9.0) ───────────────────────────────────────────
//
// A Verified Trap is reward-gradable because ONE deterministic procedure returns
// RED on the vulnerable code and GREEN on the fixed code, runnable by anyone with
// no secret answer key. Until v0.9.0 that procedure was always the static checker
// (`auditWithRule`). v0.9.0 makes the *procedure* pluggable while keeping the
// *verdict* identical: every backend answers the same question — "does this code
// ship the trap?" — and returns the same two-color verdict.
//
// The interface is uniform across tiers and contexts; the ISOLATION STRENGTH a
// Tier-2 backend uses is a function of trust (whose code, where), not a global
// switch. Tier 0 (static) stays the default everywhere — offline, deterministic,
// no LLM, no code execution — so the cheap path is exactly as cheap as 0.8.3.

export type OracleColor = "RED" | "GREEN" | "UNKNOWN";

export type OracleMethod =
  | "static-checker"
  | "executed-test"
  | "compiler"
  | "differential";

// A reproducibility receipt: enough for a buyer to re-run the oracle and get the
// same color. Free-form per backend (compiler diagnostics, test name, diff).
export type OracleEvidence = Record<string, unknown>;

// The single verdict every backend returns. RED = trap shipped, GREEN = trap
// avoided, UNKNOWN = the oracle could not decide (today's `cant_tell`; counts as
// GREEN for *gating*, but is NEVER valid as the red/green proof on a record).
export interface OracleVerdict {
  color: OracleColor;
  method: OracleMethod; // what proved it — lands in a record's proof method
  detail: string; // human-readable why (mirrors CheckOutcome.detail)
  evidence?: OracleEvidence; // reproducibility receipt
  durationMs?: number;
}

// WHOSE code and WHERE — selects the isolation strength a Tier-2 backend uses.
//   "local"  = the user's own code on their own machine  → light isolate is enough.
//   "ingest" = a contributor's code on our infra         → hardened sandbox enforced.
// Defaults to "local"; an ingest pipeline sets "ingest" explicitly.
export type OracleContext = "local" | "ingest";

// A target to verify: a directory of code + the rule/spec that defines the trap.
export interface OracleTarget {
  dir: string; // the candidate code (vulnerable/fixed fixture, or a scanned project)
  rule: Rule; // carries id, lang, component, and the check/test binding
  context?: OracleContext;
}

export interface OracleBackend {
  method: OracleMethod;
  // Trust tier — gates whether this backend may run under the current config.
  //   0 = static (no execution)   1 = compiler (compiler only, no program)
  //   2 = executed/differential (runs code; isolation scales to context)
  tier: 0 | 1 | 2;
  // Can this backend even attempt this rule? Cheap, no execution.
  supports(rule: Rule): boolean;
  // The verdict. MUST be deterministic for a given (dir, rule) under pinned deps.
  // A Tier-2 backend picks its sandbox from target.context and REFUSES (→ UNKNOWN)
  // if context is "ingest" and the hardened sandbox isn't available.
  verify(target: OracleTarget): Promise<OracleVerdict>;
}

// Highest tier a run is allowed to use. Tier 2 is opt-in only; Tier 0/1 are
// offline+deterministic and safe to enable by default for verification.
export type OracleTier = 0 | 1 | 2;
