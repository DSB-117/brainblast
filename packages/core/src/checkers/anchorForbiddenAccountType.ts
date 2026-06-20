import type { RustCandidate, CheckOutcome } from "../types.ts";

// Checker: anchor-forbidden-account-type
//
// Detects Anchor instruction handlers where any account field uses a forbidden
// account type. The canonical use case is UncheckedAccount<'info>:
//
//   Anchor requires a `/// CHECK:` safety comment on UncheckedAccount fields
//   but performs zero runtime validation on the account — ownership, signer
//   status, and data layout are all unchecked. AI coding agents routinely reach
//   for UncheckedAccount as a lazy placeholder, add a boilerplate CHECK comment,
//   and ship without ever adding the actual validation logic.
//
// The rule FAILs on presence alone — the correct fix is to replace the
// unchecked type with a typed account (Account<'info, T>, Signer<'info>,
// SystemAccount<'info>, etc.) so Anchor enforces invariants automatically.
//
// Params:
//   forbiddenType  — substring to match in field typeName (default: "UncheckedAccount")
//   passDetail     — PASS message override
//   failDetail     — FAIL message override
//   absentDetail   — CANT_TELL message override

const DEFAULT_FORBIDDEN = "UncheckedAccount";

export function anchorForbiddenAccountType(c: RustCandidate, p: any): CheckOutcome {
  const forbidden: string = (p?.forbiddenType as string) ?? DEFAULT_FORBIDDEN;

  const flagged = c.accountFields.filter((f) => f.typeName.includes(forbidden));

  if (flagged.length === 0) {
    // If there are account fields but none are the forbidden type, the handler is clean.
    if (c.accountFields.length > 0) {
      return {
        result: "pass",
        detail:
          (p?.passDetail as string) ??
          `Handler '${c.fnName}' has no '${forbidden}' account fields.`,
      };
    }
    return {
      result: "cant_tell",
      detail:
        (p?.absentDetail as string) ??
        `Handler '${c.fnName}' has no account fields to inspect; rule does not apply.`,
    };
  }

  const names = flagged.map((f) => `'${f.name}'`).join(", ");
  return {
    result: "fail",
    detail:
      (p?.failDetail as string) ??
      `Handler '${c.fnName}' uses ${forbidden}<'info> on account(s) ${names}. ` +
        `${forbidden} performs no runtime validation — ownership, signer status, and data layout are entirely unchecked. ` +
        `Replace with a typed account: Account<'info, T> (program-owned data), Signer<'info> (must sign), ` +
        `SystemAccount<'info> (system-owned), or InterfaceAccount<'info, T> (Token-2022 compatible).`,
  };
}
