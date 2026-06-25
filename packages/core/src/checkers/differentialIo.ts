import type { Candidate, CheckOutcome } from "../types.ts";

// A "differential-io" rule asks a question STATIC ANALYSIS CANNOT ANSWER: "does
// this code COMPUTE the right answer?" That verdict is owned by the Tier-2
// `differential` oracle (src/oracle/backends/differential.ts), which runs the
// candidate against a vetted golden I/O table in the sandbox.
//
// This stub keeps the kind in the vetted registry so loadRules() accepts a rule
// that binds to it (the loop still fails CLOSED on unknown kinds). On the static
// path it returns cant_tell: the static engine has no opinion on runtime output,
// so it abstains rather than guess.
export function differentialIo(_c: Candidate, _params: any): CheckOutcome {
  return {
    result: "cant_tell",
    detail:
      "Whether this code computes the correct output is decided by the differential " +
      "oracle (golden I/O), not static analysis. Re-run with --oracle=differential " +
      "(opt-in; executes the candidate in a sandbox).",
  };
}
