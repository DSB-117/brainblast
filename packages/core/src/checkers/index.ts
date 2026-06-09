import { positionalArgIdentity } from "./positionalArgIdentity.ts";
import { requiredCallWithOptions } from "./requiredCallWithOptions.ts";
import { feeAllocationShape } from "./feeAllocationShape.ts";
import { argEqualsConstantIdentifier } from "./argEqualsConstantIdentifier.ts";
import { objectArgPropertyLiteralEquals } from "./objectArgPropertyLiteralEquals.ts";
import { anchorInitIfNeededGuarded } from "./anchorInitIfNeededGuarded.ts";
import type { Candidate, RustCandidate, CheckOutcome, Checker, RustChecker } from "../types.ts";

// Registry of human-vetted checker templates. Rules bind to these by `kind`.
// TypeScript checkers receive Candidate; Rust checkers receive RustCandidate.
const registry: Record<string, Checker | RustChecker> = {
  "positional-arg-identity": positionalArgIdentity,
  "required-call-with-options": requiredCallWithOptions,
  "fee-allocation-shape": feeAllocationShape,
  "arg-equals-constant-identifier": argEqualsConstantIdentifier,
  "object-arg-property-literal-equals": objectArgPropertyLiteralEquals,
  "anchor-init-if-needed-guarded": anchorInitIfNeededGuarded as RustChecker,
};

export function runChecker(kind: string, c: Candidate | RustCandidate, params: any): CheckOutcome {
  const fn = registry[kind];
  if (!fn) return { result: "cant_tell", detail: `Unknown checker kind '${kind}'.` };
  return (fn as (c: any, p: any) => CheckOutcome)(c, params);
}

export const checkerKinds = Object.keys(registry);
