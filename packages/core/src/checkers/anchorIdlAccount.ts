import type { RustCandidate, RustAccountField, CheckOutcome } from "../types.ts";
import { toSnakeCase, type IdlConstraintParams } from "../idlRules.ts";

// Checker kind: anchor-account-matches-idl
//
// Receives one Rust instruction handler (RustCandidate) and the IDL constraint
// manifest (check.params). It verifies that every account the IDL declares as a
// signer is declared `Signer<'info>` (or `#[account(signer)]`) in the Rust
// Accounts struct, and every account declared mutable carries `mut` / `init`.
//
// PASS       — every IDL-promised signer/mut constraint is present.
// FAIL       — at least one promised constraint is missing (an auth hole).
// CANT_TELL  — this handler isn't in the IDL, or the IDL has no constraints for it.

function fieldIsSigner(f: RustAccountField): boolean {
  // Anchor renders signer accounts as `Signer<'info>` or with an explicit
  // `signer` constraint in the #[account(...)] attribute.
  if (/\bSigner\s*</.test(f.typeName)) return true;
  if (/\bsigner\b/.test(f.attrText)) return true;
  return false;
}

function fieldIsMut(f: RustAccountField): boolean {
  // `mut`, `init`, or `init_if_needed` all make the account writable.
  if (/\bmut\b/.test(f.attrText)) return true;
  if (/\binit\b/.test(f.attrText)) return true;
  if (f.hasInitIfNeeded) return true;
  return false;
}

export function anchorIdlAccount(c: RustCandidate, params: IdlConstraintParams): CheckOutcome {
  const handlerName = toSnakeCase(c.fnName);
  const spec = params?.instructions?.find((i) => i.name === handlerName);

  if (!spec) {
    return {
      result: "cant_tell",
      detail: `Handler '${c.fnName}' is not declared in the ${params?.idlName ?? "IDL"}; constraint rule does not apply.`,
    };
  }

  if (spec.signers.length === 0 && spec.mutable.length === 0) {
    return {
      result: "cant_tell",
      detail: `Instruction '${spec.name}' declares no signer or mutable accounts in the IDL; nothing to verify.`,
    };
  }

  // Index Rust fields by snake_case name.
  const byName = new Map<string, RustAccountField>();
  for (const f of c.accountFields) byName.set(toSnakeCase(f.name), f);

  const violations: string[] = [];

  for (const acct of spec.signers) {
    const f = byName.get(acct);
    if (!f) {
      violations.push(`'${acct}' (IDL signer) is not present in the Accounts struct`);
    } else if (!fieldIsSigner(f)) {
      violations.push(`'${acct}' must be a Signer (IDL marks it isSigner) but the Rust field has no signer constraint`);
    }
  }

  for (const acct of spec.mutable) {
    const f = byName.get(acct);
    if (!f) {
      violations.push(`'${acct}' (IDL mutable) is not present in the Accounts struct`);
    } else if (!fieldIsMut(f)) {
      violations.push(`'${acct}' must be mutable (IDL marks it isMut) but the Rust field has no mut/init constraint`);
    }
  }

  if (violations.length > 0) {
    return {
      result: "fail",
      detail:
        `Handler '${c.fnName}' diverges from the ${params.idlName} IDL: ` +
        violations.join("; ") +
        ". A missing signer/mut constraint is a silent authorization hole.",
    };
  }

  return {
    result: "pass",
    detail: `Handler '${c.fnName}' declares all ${spec.signers.length} signer and ${spec.mutable.length} mutable account(s) the ${params.idlName} IDL requires.`,
  };
}
