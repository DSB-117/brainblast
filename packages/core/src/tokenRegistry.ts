// Token identity verification against canonical registries (Problem 1:
// "is this mint actually the USDC/JUP/etc. I think it is, or an impersonator?").
//
// Two-layer strategy:
//   1. Bundled offline snapshot (src/solanaCanonicalMints.ts) — the blue-chip
//      symbols most likely to be hardcoded and impersonated. No network.
//   2. Jupiter verified token list (live) — a single-token GET resolves the
//      queried mint's symbol + verified tag for the long tail.
//
// Impersonation is detected by SYMBOL COLLISION: a token whose symbol is a
// known canonical symbol (e.g. "USDC") but whose mint is NOT that symbol's
// canonical mint is, by definition, an impersonator — the on-chain metadata
// symbol is attacker-controlled, so a matching string at the wrong mint is the
// signal, not proof of authenticity.

import {
  CANONICAL_MINTS,
  CANONICAL_BY_MINT,
  canonicalMintForSymbol,
} from "./solanaCanonicalMints.ts";

export type IdentityStatus =
  | "verified-canonical" // mint is the canonical mint in our bundled snapshot
  | "verified" // Jupiter lists it with the "verified" tag
  | "unverified" // Jupiter knows it but it is not verified
  | "unknown"; // no registry has it

export interface TokenIdentity {
  mint: string;
  status: IdentityStatus;
  symbol?: string;
  name?: string;
  source: "bundled" | "jupiter" | "none";
  /** True when the mint impersonates a known canonical symbol at the wrong address. */
  impersonation: boolean;
  /** When impersonation is true, the REAL canonical mint for the claimed symbol. */
  canonicalMint?: string;
  /** When `expectSymbol` was supplied and the resolved symbol does not match it. */
  expectMismatch?: boolean;
  detail: string;
}

export interface VerifyOpts {
  /** The symbol the caller expects this mint to be (e.g. from `--expect USDC`). */
  expectSymbol?: string;
  /**
   * The symbol the token claims on-chain (e.g. from Rico's tokenMetadata.symbol).
   * Used for collision detection when the mint is unknown to our snapshot.
   */
  claimedSymbol?: string;
  /** Override the Jupiter base URL (default https://tokens.jup.ag). */
  baseUrl?: string;
  /** Skip the network call (offline-only: bundled snapshot). */
  offline?: boolean;
}

interface JupToken {
  address: string;
  name?: string;
  symbol?: string;
  tags?: string[];
}

const DEFAULT_BASE = "https://tokens.jup.ag";

/** Fetch a single token's metadata from the Jupiter token list. null on 404/error. */
async function fetchJupToken(mint: string, baseUrl: string): Promise<JupToken | null> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/token/${mint}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null; // network failure is treated as "unknown", never throws
  }
  if (res.status === 404) return null;
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as JupToken | null;
    if (!data || typeof data.address !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Resolve whether `mint` is the token the caller believes it is, and flag
 * impersonation when its symbol collides with a canonical symbol at the wrong
 * address. Never throws — registry/network failure degrades to "unknown".
 */
export async function verifyTokenIdentity(
  mint: string,
  opts: VerifyOpts = {},
): Promise<TokenIdentity> {
  const expect = opts.expectSymbol?.toUpperCase();

  // Layer 1 — bundled snapshot. If the mint IS a canonical mint, it's the real
  // thing, full stop.
  const canonical = CANONICAL_BY_MINT[mint];
  if (canonical) {
    const expectMismatch = !!expect && expect !== canonical.symbol.toUpperCase();
    return {
      mint,
      status: "verified-canonical",
      symbol: canonical.symbol,
      name: canonical.name,
      source: "bundled",
      impersonation: false,
      expectMismatch,
      detail: expectMismatch
        ? `Mint is canonical ${canonical.symbol}, but you expected ${expect}. This is the real ${canonical.symbol}, not ${expect}.`
        : `Verified: canonical ${canonical.symbol} (${canonical.name}).`,
    };
  }

  // Layer 2 — Jupiter live lookup (unless offline).
  const jup = opts.offline ? null : await fetchJupToken(mint, opts.baseUrl ?? DEFAULT_BASE);
  const verified = !!jup?.tags?.includes("verified");
  const resolvedSymbol = jup?.symbol ?? opts.claimedSymbol;

  // Collision check: does the TOKEN'S OWN symbol (from the registry or its
  // on-chain metadata) have a canonical mint that is NOT this mint? If so, the
  // token impersonates a blue-chip symbol. Driven by what the token asserts —
  // never by the caller's `expect` (an expectation is not an impersonation).
  const claimed = resolvedSymbol?.toUpperCase();
  const canonicalForClaim = claimed ? canonicalMintForSymbol(claimed) : undefined;
  const impersonation = !!canonicalForClaim && canonicalForClaim.mint !== mint;

  if (impersonation && canonicalForClaim) {
    return {
      mint,
      status: jup ? (verified ? "verified" : "unverified") : "unknown",
      symbol: resolvedSymbol,
      name: jup?.name,
      source: jup ? "jupiter" : "none",
      impersonation: true,
      canonicalMint: canonicalForClaim.mint,
      detail:
        `IMPERSONATION: this mint carries the symbol "${claimed}" but the canonical ${canonicalForClaim.symbol} ` +
        `is ${canonicalForClaim.mint}. The on-chain symbol is attacker-controlled — do not trust it. ` +
        `Use ${canonicalForClaim.mint} for ${canonicalForClaim.symbol}.`,
    };
  }

  if (jup) {
    const expectMismatch = !!expect && !!jup.symbol && expect !== jup.symbol.toUpperCase();
    return {
      mint,
      status: verified ? "verified" : "unverified",
      symbol: jup.symbol,
      name: jup.name,
      source: "jupiter",
      impersonation: false,
      expectMismatch,
      detail: verified
        ? `Jupiter-verified token ${jup.symbol ?? "(no symbol)"}${expectMismatch ? ` — but you expected ${expect}` : ""}.`
        : `Known to Jupiter but NOT verified (${jup.symbol ?? "no symbol"}). Treat as unverified; check quality before supporting.`,
    };
  }

  // Unknown everywhere.
  const expectMismatch = !!expect; // we expected a specific symbol and found nothing
  return {
    mint,
    status: "unknown",
    symbol: opts.claimedSymbol,
    source: "none",
    impersonation: false,
    expectMismatch,
    detail: expect
      ? `Unknown mint — no registry lists it, so it is certainly not the verified ${expect}.`
      : `Unknown mint — not in the bundled snapshot or the Jupiter verified list. New or unlisted token; rely on the quality scan.`,
  };
}

/** Exposed for callers/tests that want the raw canonical table. */
export { CANONICAL_MINTS };
