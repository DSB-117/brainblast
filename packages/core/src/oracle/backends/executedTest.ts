import { testKinds } from "../../testTemplates/index.ts";
import type { OracleBackend, OracleVerdict, OracleTarget } from "../types.ts";
import type { Rule } from "../../types.ts";

// Tier 2 — the BEHAVIORAL oracle: render the vetted contract test for the rule,
// run it against the candidate in a sandbox; RED if it fails, GREEN if it passes.
// This catches errors with no nameable static shape — wrong return value, an
// exception under a specific input, state mutated incorrectly.
//
// v0.9.0 SHIPS THE SEAM, NOT THE SANDBOX. Tier 2 runs candidate code, which is a
// security question (see V0.9.0-PLAN.md "Two properties"): a light isolate is
// enough for the user's own code locally, but a contributor's code on our infra
// (context: "ingest") demands a hardened container that REFUSES rather than falls
// back. That sandbox lands in v0.9.1. Until then this backend is correctly wired
// — uniform interface, tier, supports(), honest refusal — and decides nothing:
// it returns UNKNOWN with a reason, so it never overclaims a proof it can't make.
//
// Honesty guard: an executed-test RED only ever counts when the test is a VETTED
// template bound by test.kind (a contributor supplies fixtures, never oracles).
function supports(rule: Rule): boolean {
  const kind = rule.test?.kind;
  return !!kind && kind !== "none" && testKinds.includes(kind);
}

export const executedTestBackend: OracleBackend = {
  method: "executed-test",
  tier: 2,
  supports,
  async verify({ context }: OracleTarget): Promise<OracleVerdict> {
    // The hardened ingest sandbox is non-negotiable on the ingest path: a missing
    // sandbox is a refusal (UNKNOWN), never an unprotected run.
    const where = context === "ingest" ? "the hardened ingest sandbox" : "the local isolate";
    return {
      color: "UNKNOWN",
      method: "executed-test",
      detail:
        `executed-test is a Tier-2 (code-executing) backend. ${where} ships in ` +
        `v0.9.1; until then it abstains rather than run candidate code. UNKNOWN ` +
        `counts as GREEN for gating but is never a proof.`,
    };
  },
};
