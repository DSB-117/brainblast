import { fixPositionalArgIdentity } from "./positionalArgIdentity.ts";
import { fixRequiredCallWithOptions } from "./requiredCallWithOptions.ts";
import type { Candidate, RustCandidate, CheckOutcome, Fix, Fixer } from "../types.ts";

// Registry of human-vetted fixer templates, keyed by the same `check.kind`
// used for checkers (see checkers/index.ts). A rule with no entry here simply
// produces no `fix` field — Fix-it mode is purely additive.
const registry: Record<string, Fixer> = {
  "positional-arg-identity": fixPositionalArgIdentity,
  "required-call-with-options": fixRequiredCallWithOptions,
};

export function runFixer(
  kind: string,
  c: Candidate | RustCandidate,
  params: any,
  outcome: CheckOutcome,
): Fix | undefined {
  if (outcome.result !== "fail") return undefined;
  const fn = registry[kind];
  if (!fn) return undefined;
  // Rust candidates have no ts-morph `fn`; only TS-checker kinds are registered above.
  return (fn as (c: any, p: any, o: CheckOutcome) => Fix | undefined)(c, params, outcome);
}

export const fixerKinds = Object.keys(registry);
