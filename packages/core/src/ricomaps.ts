// Rico Maps API client — Solana token quality/safety scoring (Problem 2).
// https://github.com/nullxnothing/ricomaps  (hosted: https://ricomaps.fun)
//
// Calls POST /api/v1/analyze, which traces holder funding chains and flags
// cabal funders, snipers, and Jito bundle clusters, returning a 0–100 risk
// score plus token-security facts (mint/freeze authority, mutability).
//
// This is a NETWORK-class module (like osv/diff/drift) — it never runs inside
// the offline `brainblast .` auditor. The API key is optional: callers can
// graceful-skip the quality scan when no key is available (see cli runRico).

export interface RicoTokenSecurity {
  hasMintAuthority: boolean;
  mintAuthority?: string;
  hasFreezeAuthority: boolean;
  freezeAuthority?: string;
  isMutable: boolean;
  riskLevel?: "low" | "medium" | "high" | "critical";
  riskFactors?: string[];
  supply?: number;
  decimals?: number;
}

export interface RicoResult {
  mint: string;
  /** Funding-graph risk score, 0–100 (cabal/sniper/bundle weighted). */
  riskScore: number;
  totalHolders: number;
  cabalCount: number;
  snipersDetected: number;
  /** snipersDetected / totalHolders, rounded to a percentage. */
  sniperPct: number;
  bundleClustersDetected: number;
  holderQuality?: unknown;
  symbol?: string;
  name?: string;
  tokenSecurity?: RicoTokenSecurity;
  /** Human-readable deployer/security flags derived from tokenSecurity. */
  deployerFlags: string[];
  tier?: string;
  processingMs?: number;
}

export type RicoOutcome =
  | { ok: true; result: RicoResult }
  | {
      ok: false;
      kind: "auth" | "rate-limit" | "bad-request" | "server" | "network";
      status?: number;
      error: string;
      retryAfterMs?: number;
    };

const DEFAULT_BASE = "https://ricomaps.fun";

/** Translate the structured tokenSecurity block into human-readable flags. */
export function deployerFlagsFrom(sec?: RicoTokenSecurity): string[] {
  const flags: string[] = [];
  if (!sec) return flags;
  if (sec.hasMintAuthority)
    flags.push(`Mint authority ACTIVE${sec.mintAuthority ? ` (${sec.mintAuthority})` : ""} — supply can still be inflated`);
  if (sec.hasFreezeAuthority)
    flags.push(`Freeze authority ACTIVE${sec.freezeAuthority ? ` (${sec.freezeAuthority})` : ""} — holder accounts can be frozen`);
  if (sec.isMutable) flags.push("Metadata is MUTABLE — name/symbol/URI can change after launch");
  for (const f of sec.riskFactors ?? []) flags.push(f);
  return flags;
}

/**
 * Analyze a token mint via Rico Maps. Returns a discriminated outcome so the
 * caller can graceful-skip on `auth` (missing/invalid key) without treating it
 * as a hard failure. Never throws.
 */
export async function analyzeToken(
  mint: string,
  opts: { apiKey?: string; baseUrl?: string } = {},
): Promise<RicoOutcome> {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ mint, apiKey: opts.apiKey }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e: unknown) {
    return { ok: false, kind: "network", error: `Rico Maps request failed: ${(e as Error).message ?? String(e)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: "auth", status: res.status, error: "Rico Maps rejected the API key (missing, invalid, or out of quota)." };
  }
  if (res.status === 429) {
    const ra = res.headers.get("Retry-After");
    const retryAfterMs = ra ? parseInt(ra, 10) * 1000 : undefined;
    return { ok: false, kind: "rate-limit", status: 429, error: "Rico Maps rate limit hit.", retryAfterMs };
  }
  if (res.status === 400) {
    return { ok: false, kind: "bad-request", status: 400, error: "Rico Maps rejected the request (invalid mint?)." };
  }
  if (!res.ok) {
    return { ok: false, kind: "server", status: res.status, error: `Rico Maps server error: ${res.status} ${res.statusText}` };
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return { ok: false, kind: "server", error: "Rico Maps returned non-JSON." };
  }
  if (!data?.success) {
    return { ok: false, kind: "server", error: data?.error ?? "Rico Maps analysis failed." };
  }

  const summary = data.summary ?? {};
  const totalHolders = Number(summary.totalHolders ?? 0);
  const snipersDetected = Number(summary.snipersDetected ?? 0);
  const security: RicoTokenSecurity | undefined = data.tokenSecurity ?? undefined;

  const result: RicoResult = {
    mint,
    riskScore: Number(summary.riskScore ?? 0),
    totalHolders,
    cabalCount: Number(summary.cabalCount ?? 0),
    snipersDetected,
    sniperPct: totalHolders > 0 ? Math.round((snipersDetected / totalHolders) * 100) : 0,
    bundleClustersDetected: Number(summary.bundleClustersDetected ?? 0),
    holderQuality: summary.holderQuality,
    symbol: data.tokenMetadata?.symbol,
    name: data.tokenMetadata?.name,
    tokenSecurity: security,
    deployerFlags: deployerFlagsFrom(security),
    tier: data.tier,
    processingMs: data.processingMs,
  };
  return { ok: true, result };
}

/** Render a Rico Maps result as a human-readable block. */
export function renderRicoText(r: RicoResult): string {
  const lines: string[] = [];
  lines.push(`  Risk score:      ${r.riskScore}/100  (funding-graph: cabal/sniper/bundle weighted)`);
  lines.push(`  Holders:         ${r.totalHolders}`);
  lines.push(`  Snipers:         ${r.snipersDetected} (${r.sniperPct}% of holders)`);
  lines.push(`  Cabal funders:   ${r.cabalCount}`);
  lines.push(`  Bundle clusters: ${r.bundleClustersDetected}`);
  if (r.tokenSecurity?.riskLevel) lines.push(`  Token security:  ${r.tokenSecurity.riskLevel.toUpperCase()}`);
  if (r.deployerFlags.length > 0) {
    lines.push(`  Deployer flags:`);
    for (const f of r.deployerFlags) lines.push(`    - ${f}`);
  } else {
    lines.push(`  Deployer flags:  none`);
  }
  return lines.join("\n");
}
