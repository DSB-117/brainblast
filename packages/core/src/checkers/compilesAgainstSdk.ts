import type { Candidate, CheckOutcome } from "../types.ts";

// A "compiles-against-sdk" rule asks a question STATIC ANALYSIS CANNOT ANSWER:
// "does this code type-check against the real, pinned SDK?" That verdict is owned
// by the Tier-1 `compiler` oracle backend (src/oracle/backends/compiler.ts), which
// runs the type-checker only — never the program.
//
// This stub exists so the kind is in the vetted registry and loadRules() accepts
// a rule that binds to it (the loop still fails CLOSED on unknown kinds). On the
// static path it deliberately returns cant_tell: the static engine has no opinion
// on whether an API exists at a given version, so it abstains rather than guess.
export function compilesAgainstSdk(_c: Candidate, params: any): CheckOutcome {
  const sdk = params?.sdk ? `${params.sdk}${params.version ? `@${params.version}` : ""}` : "the pinned SDK";
  return {
    result: "cant_tell",
    detail:
      `Whether this code type-checks against ${sdk} is decided by the compiler ` +
      `oracle, not static analysis. Re-run with --oracle=compiler (or --oracle=best).`,
  };
}
