import type { RustCandidate } from "../types.ts";
import type { CheckOutcome } from "../types.ts";

// ── Guard detection ─────────────────────────────────────────────────────────
//
// An acceptable reinitialization guard is any of:
//
//   1. require!(expr, ErrorCode) — the canonical Anchor pattern.
//      The `require!` macro is hoisted to the top of the handler and
//      aborts the instruction if the condition fails.
//
//   2. data_is_empty() — low-level account discriminator check.
//
//   3. is_initialized — common bool flag pattern.
//
// We also accept `require_eq!` and `require_keys_eq!` as guard variants.
// We intentionally do NOT accept bare `if`/`match` without an error return —
// they could be no-op branches that don't actually abort.
//
// The text search operates on the raw body string. tree-sitter is used only
// for candidate extraction; the checker uses text matching for speed and
// because the guard patterns are lexically distinctive enough.

const GUARD_PATTERNS = [
  /\brequire!\s*\(/,          // require!(...)
  /\brequire_eq!\s*\(/,       // require_eq!(...)
  /\brequire_keys_eq!\s*\(/,  // require_keys_eq!(...)
  /\.data_is_empty\s*\(\s*\)/, // account.data_is_empty()
  /\bis_initialized\b/,       // is_initialized flag check
];

function hasReinitGuard(bodyText: string): boolean {
  return GUARD_PATTERNS.some((re) => re.test(bodyText));
}

// ── Checker ─────────────────────────────────────────────────────────────────
//
// Params (all optional — defaults shown):
//   passDetail         — PASS message
//   failAbsentDetail   — FAIL: init_if_needed present, no guard
//   absentDetail       — CANT_TELL: no init_if_needed account in this handler
//
// The checker receives a RustCandidate (not a TypeScript Candidate).
// It is registered in checkers/index.ts as "anchor-init-if-needed-guarded".
export function anchorInitIfNeededGuarded(c: RustCandidate, p: any): CheckOutcome {
  // Find accounts with init_if_needed
  const risky = c.accountFields.filter((f) => f.hasInitIfNeeded);

  if (risky.length === 0) {
    // No init_if_needed accounts — rule doesn't apply to this handler.
    return {
      result: "cant_tell",
      detail:
        (p.absentDetail as string) ??
        `Handler '${c.fnName}' has no #[account(init_if_needed)] fields; the reinit-guard rule does not apply.`,
    };
  }

  // At least one init_if_needed account — check the handler body for a guard.
  if (hasReinitGuard(c.fnBodyText)) {
    return {
      result: "pass",
      detail:
        (p.passDetail as string) ??
        `Handler '${c.fnName}' has #[account(init_if_needed)] on [${risky.map((f) => f.name).join(", ")}] and a reinitialization guard was detected.`,
    };
  }

  return {
    result: "fail",
    detail:
      (p.failAbsentDetail as string) ??
      `Handler '${c.fnName}' has #[account(init_if_needed)] on [${risky.map((f) => f.name).join(", ")}] but no reinitialization guard (require!, data_is_empty, is_initialized). A second invocation will silently overwrite the account state.`,
  };
}
