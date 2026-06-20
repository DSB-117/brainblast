import type { RustCandidate, CheckOutcome } from "../types.ts";

// Checker: anchor-account-missing-constraint
//
// Detects Anchor instruction handlers where an authority-named account field
// (authority, admin, owner, payer, signer, etc.) is typed as AccountInfo<'info>
// without a `signer` constraint — or without using Signer<'info> directly.
//
// Missing signer validation is a critical vulnerability: an attacker can pass
// any arbitrary key as the "authority" and execute privileged operations without
// actually owning that key. Anchor will not enforce signing on AccountInfo fields
// unless the `signer` constraint is explicit.
//
// Params:
//   nameRegex    — regex matched against field name (default: common authority names)
//   passDetail   — PASS message override
//   failDetail   — FAIL message override
//   absentDetail — CANT_TELL message override

const DEFAULT_AUTHORITY_RE =
  /^(authority|admin|owner|payer|caller|signer|user|operator|manager|creator|deployer)$/i;

export function anchorAccountMissingConstraint(c: RustCandidate, p: any): CheckOutcome {
  const namePattern = p?.nameRegex ? new RegExp(p.nameRegex as string) : DEFAULT_AUTHORITY_RE;

  const authorityFields = c.accountFields.filter((f) => namePattern.test(f.name));

  if (authorityFields.length === 0) {
    return {
      result: "cant_tell",
      detail:
        (p?.absentDetail as string) ??
        `Handler '${c.fnName}' has no authority-named account fields matching the pattern; rule does not apply.`,
    };
  }

  const missing = authorityFields.filter(
    (f) =>
      f.typeName.includes("AccountInfo") &&
      !f.attrText.includes("signer") &&
      !f.typeName.includes("Signer<"),
  );

  if (missing.length > 0) {
    const names = missing.map((f) => `'${f.name}'`).join(", ");
    return {
      result: "fail",
      detail:
        (p?.failDetail as string) ??
        `Handler '${c.fnName}': authority-named field(s) ${names} use AccountInfo<'info> without a \`signer\` ` +
          `constraint. Anchor performs no signing check on AccountInfo — any key can be passed as the ` +
          `authority and privileged instructions will execute without signature validation. ` +
          `Fix: change the type to Signer<'info>, or add #[account(signer)] to the field's constraint.`,
    };
  }

  return {
    result: "pass",
    detail:
      (p?.passDetail as string) ??
      `Handler '${c.fnName}': all authority-named fields use Signer<'info> or have a signer constraint.`,
  };
}
