import type { OracleBackend, OracleVerdict, OracleTarget } from "../types.ts";
import type { Rule } from "../../types.ts";

// Tier 2 — the REFERENCE oracle: run the candidate and a known-correct reference
// (or a recorded golden I/O table) on the same inputs; RED if outputs diverge,
// GREEN if they match. This grades "is this the SAME AS correct" — off-by-one,
// wrong rounding mode, a reimplementation right on the happy path and wrong on an
// edge — the long tail of "looks right, computes wrong" where static rules are
// weakest (`wrong-constant`, unit/scaling bugs, serialization mismatches).
//
// Two flavors, both deterministic: (a) golden-I/O — a recorded input→output table,
// candidate-only execution; (b) live reference — a vetted reference runs alongside.
// Both execute code, so both are Tier 2 and share the context-scaled sandbox with
// the executed-test backend.
//
// v0.9.0 ships the seam, not the sandbox (see executedTest.ts). This backend is
// wired and honest: it supports rules carrying a reference/golden table, and
// abstains (UNKNOWN) until the sandbox lands in v0.9.1.
//
// Honesty guard: the reference / golden table must be VETTED and owned — a
// contributor supplies candidate code and *claimed* behavior, never the oracle.
function supports(rule: Rule): boolean {
  const p = rule.check?.params ?? {};
  return rule.check?.kind === "differential-io" || !!p.reference || !!p.golden;
}

export const differentialBackend: OracleBackend = {
  method: "differential",
  tier: 2,
  supports,
  async verify({ context }: OracleTarget): Promise<OracleVerdict> {
    const where = context === "ingest" ? "the hardened ingest sandbox" : "the local isolate";
    return {
      color: "UNKNOWN",
      method: "differential",
      detail:
        `differential is a Tier-2 (code-executing) backend. ${where} ships in ` +
        `v0.9.1; until then it abstains rather than run candidate code. UNKNOWN ` +
        `counts as GREEN for gating but is never a proof.`,
    };
  },
};
