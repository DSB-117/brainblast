import { CANONICAL_BY_MINT, CANONICAL_MINTS } from "./solanaCanonicalMints.ts";

export type IdentityStatus = "verified-canonical" | "verified" | "unverified" | "unknown";

export interface TokenIdentity {
  mint: string;
  status: IdentityStatus;
  symbol?: string;
  name?: string;
  source: "bundled" | "jupiter" | "none";
  impersonation: boolean;
  canonicalMint?: string;
  expectMismatch?: boolean;
  detail?: string;
}

export interface VerifyOpts {
  expectSymbol?: string;
  claimedSymbol?: string;
  baseUrl?: string;
  offline?: boolean;
}

interface JupiterToken {
  symbol: string;
  name: string;
  address: string;
}

async function jupiterLookup(mint: string, baseUrl?: string): Promise<JupiterToken | null> {
  const url = `${baseUrl ?? "https://tokens.jup.ag"}/token/${mint}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as JupiterToken;
  } catch {
    return null;
  }
}

function detectImpersonation(resolvedSymbol: string | undefined): { impersonation: boolean; canonicalMint?: string } {
  if (!resolvedSymbol) return { impersonation: false };
  const upper = resolvedSymbol.toUpperCase();
  const canonical = CANONICAL_MINTS[upper];
  if (!canonical) return { impersonation: false };
  return { impersonation: true, canonicalMint: canonical.mint };
}

export async function verifyTokenIdentity(mint: string, opts: VerifyOpts = {}): Promise<TokenIdentity> {
  // Layer 1: bundled canonical snapshot — no network needed
  const bundled = CANONICAL_BY_MINT[mint];
  if (bundled) {
    const expectMismatch = opts.expectSymbol
      ? opts.expectSymbol.toUpperCase() !== bundled.symbol.toUpperCase()
      : undefined;
    return {
      mint,
      status: "verified-canonical",
      symbol: bundled.symbol,
      name: bundled.name,
      source: "bundled",
      impersonation: false,
      expectMismatch: expectMismatch ?? undefined,
    };
  }

  // Offline mode — can't do Layer 2
  if (opts.offline) {
    // Still check for impersonation using claimedSymbol
    const { impersonation, canonicalMint } = detectImpersonation(opts.claimedSymbol);
    return {
      mint,
      status: "unverified",
      source: "none",
      impersonation,
      canonicalMint,
      detail: "offline mode — Jupiter lookup skipped",
    };
  }

  // Layer 2: live Jupiter registry
  const jup = await jupiterLookup(mint, opts.baseUrl);
  if (!jup) {
    // Unknown — still check impersonation via claimedSymbol
    const { impersonation, canonicalMint } = detectImpersonation(opts.claimedSymbol);
    return {
      mint,
      status: "unknown",
      source: "none",
      impersonation,
      canonicalMint,
    };
  }

  const resolvedSymbol = jup.symbol ?? opts.claimedSymbol;
  const { impersonation, canonicalMint } = detectImpersonation(resolvedSymbol);

  const expectMismatch = opts.expectSymbol
    ? opts.expectSymbol.toUpperCase() !== (resolvedSymbol ?? "").toUpperCase()
    : undefined;

  const status: IdentityStatus = impersonation ? "unverified" : "verified";

  return {
    mint,
    status,
    symbol: jup.symbol,
    name: jup.name,
    source: "jupiter",
    impersonation,
    canonicalMint,
    expectMismatch: expectMismatch ?? undefined,
  };
}
