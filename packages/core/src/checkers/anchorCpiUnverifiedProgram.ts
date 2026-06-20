import type { RustCandidate, CheckOutcome, RustAccountField } from "../types.ts";

// Checker: anchor-cpi-unverified-program
//
// Exploit Pattern Database — Wormhole (Feb 2022, ~$325M).
//
// The Wormhole bridge's Solana program performed a cross-program invocation
// (and a signature-verification load) against an account it trusted *by
// position* instead of *by identity*. A deprecated `load_instruction_at` did
// not verify that the supplied sysvar account was the real one, so an attacker
// substituted a malicious account and forged a "verified" signature set. Root
// cause, generalized: **a program/CPI target was used without verifying its
// program ID / address.**
//
// In Anchor, the safe spelling is to type a program account as
// `Program<'info, T>` (Anchor checks the address on deserialization) or to add
// an explicit `#[account(address = <expected>)]` constraint. The dangerous
// spelling is a raw `AccountInfo<'info>` / `UncheckedAccount<'info>` that is
// then handed to `invoke` / `invoke_signed` / a `CpiContext` — the runtime will
// happily call whatever program the caller passed in.
//
// Semantics:
//   FAIL  — the handler performs a CPI AND at least one program-named account
//           is a raw AccountInfo/UncheckedAccount with no `address =` constraint
//           and no in-body key check. (The Wormhole footgun.)
//   PASS  — the handler performs a CPI and every program-named account is
//           verified: typed `Program<'info, _>`, or carries an `address =`
//           constraint, or its `.key()` is compared in the body.
//   CANT_TELL — no CPI in the body, or no program-like account field (rule does
//           not apply; no evidence to judge).
//
// Params (all optional, sensible defaults for the Anchor/Wormhole pattern):
//   programNameRegex — field-name test for "this is a program account"
//                      (default: /(^|_)program$|^program$/i)
//   cpiRegex         — body test for "a CPI happens here"
//   verifiedTypeRegex — type text that counts as address-verified (Program<>)
//   addressConstraintRegex — attr text that counts as an explicit address check

const DEFAULT_PROGRAM_NAME = "(^|_)program$|^program(_id)?$";
const DEFAULT_CPI =
  "invoke_signed\\s*\\(|invoke\\s*\\(|CpiContext::|\\.cpi\\(\\)|solana_program::program::invoke";
const DEFAULT_VERIFIED_TYPE = "Program\\s*<";
const DEFAULT_ADDRESS_CONSTRAINT = "address\\s*=";
const RAW_TYPES = ["AccountInfo", "UncheckedAccount"];

function isRawAccountType(typeName: string): boolean {
  return RAW_TYPES.some((t) => typeName.includes(t));
}

/** A field is a "program account" by name (token_program, cpi_program, program). */
function isProgramNamed(name: string, re: RegExp): boolean {
  return re.test(name);
}

export function anchorCpiUnverifiedProgram(c: RustCandidate, p: any): CheckOutcome {
  const programNameRe = new RegExp((p?.programNameRegex as string) ?? DEFAULT_PROGRAM_NAME, "i");
  const cpiRe = new RegExp((p?.cpiRegex as string) ?? DEFAULT_CPI);
  const verifiedTypeRe = new RegExp((p?.verifiedTypeRegex as string) ?? DEFAULT_VERIFIED_TYPE);
  const addressRe = new RegExp((p?.addressConstraintRegex as string) ?? DEFAULT_ADDRESS_CONSTRAINT);

  const body = c.fnBodyText ?? "";
  const performsCpi = cpiRe.test(body);

  // No CPI → this rule has nothing to judge.
  if (!performsCpi) {
    return {
      result: "cant_tell",
      detail:
        (p?.absentDetail as string) ??
        `Handler '${c.fnName}' performs no cross-program invocation; CPI program-ID verification does not apply.`,
    };
  }

  const programFields = c.accountFields.filter((f) => isProgramNamed(f.name, programNameRe));

  // CPI happens but no identifiable program account in the struct → can't tell
  // whether the invoked program is verified (it may be a hard-coded id, a bare
  // param, etc.). Fail closed only on the patterns we can prove.
  if (programFields.length === 0) {
    return {
      result: "cant_tell",
      detail:
        (p?.absentDetail as string) ??
        `Handler '${c.fnName}' performs a CPI but no program-named account field was found on '${c.accountStructName}' to verify.`,
    };
  }

  const isVerified = (f: RustAccountField): boolean => {
    // Program<'info, T> — Anchor checks the program id on deserialization.
    if (verifiedTypeRe.test(f.typeName)) return true;
    // Not a raw passthrough type (e.g. Sysvar<>, Account<>) — treat as checked.
    if (!isRawAccountType(f.typeName)) return true;
    // Explicit #[account(address = <expected>)] constraint.
    if (addressRe.test(f.attrText)) return true;
    // Explicit in-body key comparison, e.g. require_keys_eq!(token_program.key(), ...)
    // or `token_program.key() == expected`.
    const keyCheck = new RegExp(`${f.name}\\.key\\s*\\(\\s*\\)`);
    if (keyCheck.test(body)) return true;
    return false;
  };

  const unverified = programFields.filter((f) => !isVerified(f));

  if (unverified.length > 0) {
    const names = unverified.map((f) => `${f.name}: ${f.typeName}`).join(", ");
    return {
      result: "fail",
      detail:
        (p?.failDetail as string) ??
        `Handler '${c.fnName}' performs a cross-program invocation but the target program account(s) [${names}] are raw ` +
          `AccountInfo/UncheckedAccount with no address verification. An attacker can substitute a malicious program — ` +
          `this is the Wormhole ($325M, Feb 2022) class of bug. Type the account as Program<'info, T> or add ` +
          `#[account(address = <expected_program_id>)].`,
    };
  }

  return {
    result: "pass",
    detail:
      (p?.passDetail as string) ??
      `Handler '${c.fnName}' performs a CPI and every program account (${programFields
        .map((f) => f.name)
        .join(", ")}) is identity-verified (Program<'info, _>, address= constraint, or in-body key check).`,
  };
}
