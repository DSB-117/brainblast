import { positionalArgIdentity } from "./positionalArgIdentity.ts";
import { requiredCallWithOptions } from "./requiredCallWithOptions.ts";
import { feeAllocationShape } from "./feeAllocationShape.ts";
import type { Candidate, CheckOutcome, Checker } from "../types.ts";

// Registry of human-vetted checker templates. Rules bind to these by `kind`.
const registry: Record<string, Checker> = {
  "positional-arg-identity": positionalArgIdentity,
  "required-call-with-options": requiredCallWithOptions,
  "fee-allocation-shape": feeAllocationShape,
};

export function runChecker(kind: string, c: Candidate, params: any): CheckOutcome {
  const fn = registry[kind];
  if (!fn) return { result: "cant_tell", detail: `Unknown checker kind '${kind}'.` };
  return fn(c, params);
}

export const checkerKinds = Object.keys(registry);
