export interface CanonicalMint {
  symbol: string;
  name: string;
  mint: string;
}

export const CANONICAL_MINTS: Record<string, CanonicalMint> = {
  USDC: { symbol: "USDC", name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  USDT: { symbol: "USDT", name: "USD Tether", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  SOL:  { symbol: "SOL",  name: "Wrapped SOL", mint: "So11111111111111111111111111111111111111112" },
  WSOL: { symbol: "WSOL", name: "Wrapped SOL", mint: "So11111111111111111111111111111111111111112" },
  JUP:  { symbol: "JUP",  name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  BONK: { symbol: "BONK", name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  WIF:  { symbol: "WIF",  name: "dogwifhat", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  PYTH: { symbol: "PYTH", name: "Pyth Network", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  RAY:  { symbol: "RAY",  name: "Raydium", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  ORCA: { symbol: "ORCA", name: "Orca", mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  MNGO: { symbol: "MNGO", name: "Mango", mint: "MangoCzJ36AjZyKwVPDeoDLiiwVqHVDRtNoCKzSPH7" },
  mSOL: { symbol: "mSOL", name: "Marinade Staked SOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So" },
};

export const CANONICAL_BY_MINT: Record<string, CanonicalMint> = Object.fromEntries(
  Object.values(CANONICAL_MINTS).map((c) => [c.mint, c])
);

export function canonicalMintForSymbol(symbol: string): CanonicalMint | undefined {
  return CANONICAL_MINTS[symbol.toUpperCase()];
}

export function isCanonicalMint(mint: string): boolean {
  return mint in CANONICAL_BY_MINT;
}
