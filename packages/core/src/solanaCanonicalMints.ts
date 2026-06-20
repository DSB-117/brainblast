// Curated, offline snapshot of canonical Solana token mints for the most
// commonly-impersonated symbols. This is a VETTED constant map, not a live
// feed — it ships with brainblast so the static auditor (`brainblast .`) can
// verify hardcoded mint constants WITHOUT a network call, preserving the
// offline-by-design guarantee of the core auditor.
//
// The live `brainblast rico` command uses the full Jupiter verified list
// (src/tokenRegistry.ts) for fresh/complete coverage; this map is the offline
// floor for the highest-impact blue-chip symbols an app is most likely to
// hardcode (and a scammer most likely to impersonate).
//
// Snapshot date: 2026-06-16. Every entry below is the well-known canonical
// mint as published on the Jupiter verified list and the token's official
// channels. Add entries conservatively — a wrong canonical mint here would
// turn a safety check into a footgun.

export interface CanonicalMint {
  symbol: string;
  name: string;
  mint: string;
}

// symbol (UPPERCASE) -> canonical mint
export const CANONICAL_MINTS: Record<string, CanonicalMint> = {
  USDC: { symbol: "USDC", name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  USDT: { symbol: "USDT", name: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  SOL: { symbol: "SOL", name: "Wrapped SOL", mint: "So11111111111111111111111111111111111111112" },
  WSOL: { symbol: "WSOL", name: "Wrapped SOL", mint: "So11111111111111111111111111111111111111112" },
  BONK: { symbol: "BONK", name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  JUP: { symbol: "JUP", name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  JTO: { symbol: "JTO", name: "Jito", mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  PYTH: { symbol: "PYTH", name: "Pyth Network", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  RAY: { symbol: "RAY", name: "Raydium", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  ORCA: { symbol: "ORCA", name: "Orca", mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  MSOL: { symbol: "MSOL", name: "Marinade staked SOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So" },
  WIF: { symbol: "WIF", name: "dogwifhat", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
};

/** Reverse index: canonical mint -> entry. Built once at module load. */
export const CANONICAL_BY_MINT: Record<string, CanonicalMint> = Object.fromEntries(
  Object.values(CANONICAL_MINTS).map((e) => [e.mint, e]),
);

/** Look up the canonical mint for a symbol (case-insensitive). */
export function canonicalMintForSymbol(symbol: string): CanonicalMint | undefined {
  return CANONICAL_MINTS[symbol.toUpperCase()];
}

/** True if `mint` is the canonical mint for any known symbol. */
export function isCanonicalMint(mint: string): boolean {
  return mint in CANONICAL_BY_MINT;
}
