import type { RustCandidate, CheckOutcome } from "../types.ts";

// Checker: anchor-body-call-pattern
//
// Detects dangerous patterns in an Anchor instruction handler's body via
// regex text matching on fnBodyText. Parameterized — one checker kind,
// many rules.
//
// Primary use case: anchor-pda-find-program-address
//
//   Calling Pubkey::find_program_address inside an instruction handler is a
//   footgun for two reasons:
//
//   1. Security: find_program_address tries bump seeds 255→0 and returns the
//      first valid PDA. If the program stored a canonical bump at init time,
//      a handler that re-derives the PDA without using that stored bump could
//      silently accept a different nonce — or fail unpredictably when the
//      canonical bump != 255.
//
//   2. Compute: find_program_address is expensive (~1500 CU per iteration,
//      worst-case 255 iterations). Calling it inside a hot instruction
//      consumes excess compute units unnecessarily.
//
//   The correct Anchor pattern is:
//     - Declare seeds + bump constraint on the account in the Accounts struct.
//     - At init, store ctx.bumps.<account_name> in the account data.
//     - In subsequent handlers, use #[account(seeds=[...], bump=state.bump)]
//       — Anchor re-derives and verifies the PDA for you at zero extra cost.
//
// Params:
//   forbiddenPattern  — regex (string) matched against fnBodyText (required)
//   exemptPattern     — regex (string); if present and matches, result is PASS
//   passDetail        — PASS message override
//   failDetail        — FAIL message override
//   absentDetail      — CANT_TELL message override (when pattern not found)

export function anchorBodyCallPattern(c: RustCandidate, p: any): CheckOutcome {
  if (!p?.forbiddenPattern) {
    return { result: "cant_tell", detail: "anchorBodyCallPattern: no forbiddenPattern param provided." };
  }

  const forbidden = new RegExp(p.forbiddenPattern as string);
  const exempt: RegExp | null = p?.exemptPattern ? new RegExp(p.exemptPattern as string) : null;

  const hasForbidden = forbidden.test(c.fnBodyText);

  if (!hasForbidden) {
    // Pattern is absent from a real handler body — the handler is clean.
    if (c.fnBodyText.trim().length > 0) {
      return {
        result: "pass",
        detail:
          (p?.passDetail as string) ??
          `Handler '${c.fnName}' does not contain the forbidden pattern '${p.forbiddenPattern}'.`,
      };
    }
    return {
      result: "cant_tell",
      detail:
        (p?.absentDetail as string) ??
        `Handler '${c.fnName}' has an empty body; rule does not apply.`,
    };
  }

  // Exempt if a safe alternative pattern is also present
  if (exempt && exempt.test(c.fnBodyText)) {
    return {
      result: "pass",
      detail:
        (p?.passDetail as string) ??
        `Handler '${c.fnName}' contains '${p.forbiddenPattern}' but also matches the exemption pattern — considered safe.`,
    };
  }

  return {
    result: "fail",
    detail:
      (p?.failDetail as string) ??
      `Handler '${c.fnName}' body contains '${p.forbiddenPattern}', which is a known footgun pattern. ` +
        `Use the Anchor seeds + bump constraint on the Accounts struct instead of deriving PDAs at runtime.`,
  };
}
