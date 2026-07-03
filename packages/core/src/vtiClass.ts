// Trap taxonomy for Verified Trap Instances — the `class` field buyers filter on
// and the coverage heatmap (Stage 3) is built from. Single source of truth shared
// by the seed generator (scripts/gen-vti.ts) and the contributor ingest pipeline
// (src/contrib/ingest.ts) so the taxonomy can never drift between the two.

import type { Rule } from "./types.ts";

export type TrapClass =
  | "silent-zero-revenue"
  | "immutable-after-deploy"
  | "unchecked-staleness"
  | "auth-bypass"
  | "wrong-constant"
  | "unconfirmed-state"
  | "missing-slippage-guard"
  | "missing-verification"
  | "other";

export const TRAP_CLASSES: readonly TrapClass[] = [
  "silent-zero-revenue",
  "immutable-after-deploy",
  "unchecked-staleness",
  "auth-bypass",
  "wrong-constant",
  "unconfirmed-state",
  "missing-slippage-guard",
  "missing-verification",
  "other",
];

// Explicit per-rule mapping for the bundled packs; the keyword fallback keeps
// future / contributed packs classified.
export const CLASS_BY_RULE: Record<string, TrapClass> = {
  "jito-bundle-zero-tip": "unconfirmed-state",
  "jupiter-quote-zero-slippage": "missing-slippage-guard",
  "metaplex-nft-royalty-zero": "silent-zero-revenue",
  "meteora-dlmm-zero-min-out": "missing-slippage-guard",
  "pyth-price-unchecked-staleness": "unchecked-staleness",
  "raydium-compute-zero-slippage": "missing-slippage-guard",
  "solana-sendtx-unconfirmed": "unconfirmed-state",
  "spl-transfer-not-checked-in-payout": "missing-verification",
  // Fleet-sourced (R7) — explicit so the keyword heuristic can't mis-bucket them
  // (e.g. "expiration" would otherwise read as unchecked-staleness).
  "jwt-verify-ignore-expiration": "auth-bypass",
  "cors-wildcard-origin": "auth-bypass",
  "https-reject-unauthorized-disabled": "auth-bypass",
  "jwt-verify-algorithm-none": "auth-bypass",
  // Fleet-sourced (this run) — the keyword heuristic reads "auth"/"jwt"/"pkce" as
  // auth-bypass, but these are verification-step omissions and a silently-ignored
  // config flag, so pin them explicitly.
  "jwt-expressjwt-ignore-notbefore": "missing-verification",
  "stripe-betterauth-oidc-require-pkce-false": "missing-verification",
  "stripe-betterauth-oidc-allow-plain-pkce": "missing-verification",
  "jwt-node-react-ecom-mongoose-dropdups": "other",
  "solana-hive-sendtransaction-skippreflight": "unconfirmed-state",
};

export function classifyTrap(rule: Rule): TrapClass {
  if (CLASS_BY_RULE[rule.id]) return CLASS_BY_RULE[rule.id];
  const hay = `${rule.id} ${rule.title}`.toLowerCase();
  if (/royalt|fee|revenue|reward/.test(hay) && /zero|missing|0\b/.test(hay)) return "silent-zero-revenue";
  if (/immutable|after (deploy|mint)|cannot be changed/.test(hay)) return "immutable-after-deploy";
  if (/stale|freshness|expir/.test(hay)) return "unchecked-staleness";
  if (/slippage|min.?out|amount.?out/.test(hay)) return "missing-slippage-guard";
  if (/auth|jwt|verif|signature/.test(hay)) return "auth-bypass";
  if (/confirm|land|finali/.test(hay)) return "unconfirmed-state";
  if (/constant|lamports_per_sol|decimals|scal/.test(hay)) return "wrong-constant";
  return "other";
}
