import type { RustCandidate, CheckOutcome } from "../types.ts";

// Checker: anchor-account-missing-constraint
//
// Detects Anchor instruction handlers where an account field is declared as
// AccountInfo<'info> with a name that implies it should be a signing authority
// (authority, admin, owner, payer, caller, signer, user) but lacks the
// `signer` constraint in its #[account(...)] attributes.
//
// This is the root cause of unauthorized-instruction exploits: a caller passes
// any arbitrary account as the "authority" and the instruction proceeds without
// verifying the account signed the transaction.
//
// Accepted safe patterns (PASS):
//   - Field type is Signer<'info>          (auto-validates the signer)
//   - Field attrText contains "signer"     (explicit #[account(signer)] constraint)
//
// Params (all optional):
//   namePattern   — regex for authority-like field names (default below)
//   passDetail    — PASS message override
//   failDetail    — FAIL message override
//   absentDetail  — CANT_TELL message override

const DEFAULT_NAME_PATTERN = /^(authority|admin|owner|payer|caller|signer|user|operator|manager|creator|deployer)$/i;

export function anchorAccountMissingConstraint(c: RustCandidate, p: any): CheckOutcome {
  const nameRe: RegExp = p?.namePattern ? new RegExp(p.namePattern, "i") : DEFAULT_NAME_PATTERN;

  // Fields that are AccountInfo with an authority-like name
  const risky = c.accountFields.filter(
    (f) =>
      f.typeName.includes("AccountInfo") &&
      nameRe.test(f.name) &&
      !f.attrText.includes("signer"),
  );

  // Fields that are properly typed (Signer<>) or have explicit signer constraint
  const safe = c.accountFields.filter(
    (f) =>
      (f.typeName.includes("Signer") || f.attrText.includes("signer")) &&
      nameRe.test(f.name),
  );

  // No authority-like accounts at all — rule doesn't apply
  const authorityFields = c.accountFields.filter((f) => nameRe.test(f.name));
  if (authorityFields.length === 0) {
    return {
      result: "cant_tell",
      detail:
        (p?.absentDetail as string) ??
        `Handler '${c.fnName}' has no authority-named account fields; signer-constraint rule does not apply.`,
    };
  }

  if (risky.length > 0) {
    const names = risky.map((f) => `'${f.name}: ${f.typeName}'`).join(", ");
    return {
      result: "fail",
      detail:
        (p?.failDetail as string) ??
        `Handler '${c.fnName}' declares ${names} as AccountInfo<'info> without a signer constraint. ` +
          `Any account can be passed here — the instruction does not verify the caller signed the transaction. ` +
          `Fix: use 'pub ${risky[0].name}: Signer<'info>' or add #[account(signer)] to the field.`,
    };
  }

  return {
    result: "pass",
    detail:
      (p?.passDetail as string) ??
      `Handler '${c.fnName}' authority-named accounts [${safe.map((f) => f.name).join(", ")}] are properly validated as signers.`,
  };
}
