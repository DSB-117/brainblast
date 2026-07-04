import { checker as arrayPropertyContainsForbiddenLiteral } from "./arrayPropertyContainsForbiddenLiteral.ts";
import { checker as positionalArgForbiddenLiteral } from "./positionalArgForbiddenLiteral.ts";
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
import { differentialIo } from "./differentialIo.ts";
import { cstStructFieldForbiddenLiteral } from "./cstStructFieldForbiddenLiteral.ts";
import { cstMemberAccessForbidden } from "./cstMemberAccessForbidden.ts";
import type { Candidate, RustCandidate, ConfigCandidate, CstCandidate, CheckOutcome, Checker, RustChecker, ConfigChecker, CstChecker } from "../types.ts";

// Registry of human-vetted checker templates. Rules bind to these by `kind`.
// TypeScript checkers receive Candidate; Rust checkers receive RustCandidate;
// config checkers receive ConfigCandidate.
const registry: Record<string, Checker | RustChecker | ConfigChecker | CstChecker> = {
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
  // v0.9.1 — bound to the Tier-2 differential oracle; static abstains (cant_tell).
  "differential-io": differentialIo,
  "array-property-contains-forbidden-literal": arrayPropertyContainsForbiddenLiteral as Checker,
  // Positional-argument analog of object-arg-property-forbidden-literal: a call or
  // constructor whose POSITIONAL arg is a forbidden literal — new Connection(url,
  // "processed"), createHash("md5"), etc. Handles CallExpression and NewExpression.
  "positional-arg-forbidden-literal": positionalArgForbiddenLiteral as Checker,
  // Multi-language static AST (tree-sitter). Go: struct/composite-literal field set
  // to a forbidden literal (e.g. tls.Config{InsecureSkipVerify: true}). Solidity:
  // a forbidden object.property member access (e.g. tx.origin auth).
  "cst-struct-field-forbidden-literal": cstStructFieldForbiddenLiteral as CstChecker,
  "cst-member-access-forbidden": cstMemberAccessForbidden as CstChecker,
};

// Move 2 — self-extending checkers. The meta-gate (scripts/fleet-checker-gate.ts)
// registers a PROPOSED checker here so it can be proven exactly as it will run in
// production, BEFORE it's committed to the static registry above. Production never
// calls registerChecker — the overlay is empty in a normal audit. A registered
// kind is only trusted after the meta-gate proves it sound AND a human ratifies
// it into the static registry.
const overlay: Record<string, Checker | RustChecker | ConfigChecker | CstChecker> = {};

export function registerChecker(kind: string, fn: Checker | RustChecker | ConfigChecker): void {
  overlay[kind] = fn;
  if (!checkerKinds.includes(kind)) checkerKinds.push(kind);
}

export function runChecker(kind: string, c: Candidate | RustCandidate | ConfigCandidate | CstCandidate, params: any): CheckOutcome {
  const fn = overlay[kind] ?? registry[kind];
  if (!fn) return { result: "cant_tell", detail: `Unknown checker kind '${kind}'.` };
  return (fn as (c: any, p: any) => CheckOutcome)(c, params);
}

export const checkerKinds = Object.keys(registry);
