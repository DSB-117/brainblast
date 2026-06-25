import { positionalArgIdentity } from "./positionalArgIdentity.ts";
import { requiredCallWithOptions } from "./requiredCallWithOptions.ts";
import { feeAllocationShape } from "./feeAllocationShape.ts";
import { argEqualsConstantIdentifier } from "./argEqualsConstantIdentifier.ts";
import { objectArgPropertyLiteralEquals } from "./objectArgPropertyLiteralEquals.ts";
import { objectArgPropertyForbiddenLiteral } from "./objectArgPropertyForbiddenLiteral.ts";
import { anchorInitIfNeededGuarded } from "./anchorInitIfNeededGuarded.ts";
import { envSecretsCommitted } from "./envSecretsCommitted.ts";
import { taintToSink } from "./taintToSink.ts";
import { literalMultiplierWrongConstant } from "./literalMultiplierWrongConstant.ts";
import { forbiddenCallReplacement } from "./forbiddenCallReplacement.ts";
import { solanaMintIdentity } from "./solanaMintIdentity.ts";
import { anchorIdlAccount } from "./anchorIdlAccount.ts";
import { anchorAccountMissingConstraint } from "./anchorAccountMissingConstraint.ts";
import { anchorForbiddenAccountType } from "./anchorForbiddenAccountType.ts";
import { anchorBodyCallPattern } from "./anchorBodyCallPattern.ts";
import { anchorCpiUnverifiedProgram } from "./anchorCpiUnverifiedProgram.ts";
import { feeConfigsZeroOrMissing } from "./feeConfigsZeroOrMissing.ts";
import { compilesAgainstSdk } from "./compilesAgainstSdk.ts";
import type { Candidate, RustCandidate, ConfigCandidate, CheckOutcome, Checker, RustChecker, ConfigChecker } from "../types.ts";

// Registry of human-vetted checker templates. Rules bind to these by `kind`.
// TypeScript checkers receive Candidate; Rust checkers receive RustCandidate;
// config checkers receive ConfigCandidate.
const registry: Record<string, Checker | RustChecker | ConfigChecker> = {
  "positional-arg-identity": positionalArgIdentity,
  "required-call-with-options": requiredCallWithOptions,
  "fee-allocation-shape": feeAllocationShape,
  "arg-equals-constant-identifier": argEqualsConstantIdentifier,
  "object-arg-property-literal-equals": objectArgPropertyLiteralEquals,
  "object-arg-property-forbidden-literal": objectArgPropertyForbiddenLiteral,
  "anchor-init-if-needed-guarded": anchorInitIfNeededGuarded as RustChecker,
  "env-secrets-committed": envSecretsCommitted,
  "taint-to-sink": taintToSink,
  "literal-multiplier-wrong-constant": literalMultiplierWrongConstant,
  "forbidden-call-replacement": forbiddenCallReplacement,
  "solana-mint-identity-mismatch": solanaMintIdentity,
  "anchor-account-matches-idl": anchorIdlAccount as RustChecker,
  "anchor-account-missing-constraint": anchorAccountMissingConstraint as RustChecker,
  "anchor-forbidden-account-type": anchorForbiddenAccountType as RustChecker,
  "anchor-body-call-pattern": anchorBodyCallPattern as RustChecker,
  "anchor-cpi-unverified-program": anchorCpiUnverifiedProgram as RustChecker,
  "fee-configs-zero-or-missing": feeConfigsZeroOrMissing,
  // v0.9.0 — bound to the Tier-1 compiler oracle; static abstains (cant_tell).
  "compiles-against-sdk": compilesAgainstSdk,
};

export function runChecker(kind: string, c: Candidate | RustCandidate | ConfigCandidate, params: any): CheckOutcome {
  const fn = registry[kind];
  if (!fn) return { result: "cant_tell", detail: `Unknown checker kind '${kind}'.` };
  return (fn as (c: any, p: any) => CheckOutcome)(c, params);
}

export const checkerKinds = Object.keys(registry);
