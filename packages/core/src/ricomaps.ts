export interface RicoTokenSecurity {
  hasMintAuthority: boolean;
  hasFreezeAuthority: boolean;
  isMutable: boolean;
  riskLevel?: string;
  riskFactors?: string[];
}

export interface RicoResult {
  mint: string;
  riskScore: number;
  totalHolders: number;
  cabalCount: number;
  snipersDetected: boolean;
  sniperPct: number;
  bundleClustersDetected: boolean;
  symbol?: string;
  name?: string;
  tokenSecurity?: RicoTokenSecurity;
  deployerFlags: string[];
  tier?: string;
  processingMs?: number;
}

export type RicoOutcome =
  | { ok: true; result: RicoResult }
  | { ok: false; kind: "auth" | "rate-limit" | "bad-request" | "server" | "network"; status?: number; error: string; retryAfterMs?: number };

interface RicoApiResponse {
  summary: {
    totalHolders: number;
    cabalCount: number;
    riskScore: number;
    snipersDetected: boolean;
    bundleClustersDetected: boolean;
    sniperCount?: number;
  };
  tokenSecurity?: RicoTokenSecurity;
  tokenMetadata?: { symbol?: string; name?: string };
  tier?: string;
  processingMs?: number;
}

export function deployerFlagsFrom(sec?: RicoTokenSecurity): string[] {
  if (!sec) return [];
  const flags: string[] = [];
  if (sec.hasMintAuthority) flags.push("mint-authority-live");
  if (sec.hasFreezeAuthority) flags.push("freeze-authority-live");
  if (sec.isMutable) flags.push("metadata-mutable");
  if (sec.riskFactors) flags.push(...sec.riskFactors);
  return flags;
}

export function renderRicoText(r: RicoResult): string {
  const lines: string[] = [
    `Rico Maps analysis — ${r.mint}`,
    `  Risk score:    ${r.riskScore}/100`,
    `  Holders:       ${r.totalHolders}`,
    `  Cabal:         ${r.cabalCount}`,
    `  Snipers:       ${r.snipersDetected ? `yes (${(r.sniperPct * 100).toFixed(1)}%)` : "none"}`,
    `  Bundle clusters: ${r.bundleClustersDetected ? "detected" : "none"}`,
  ];
  if (r.deployerFlags.length) {
    lines.push(`  Deployer flags: ${r.deployerFlags.join(", ")}`);
  }
  if (r.tier) lines.push(`  Tier:          ${r.tier}`);
  return lines.join("\n");
}

export async function analyzeToken(
  mint: string,
  opts: { apiKey?: string; baseUrl?: string } = {}
): Promise<RicoOutcome> {
  const url = `${opts.baseUrl ?? "https://ricomaps.fun"}/api/v1/analyze`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, apiKey: opts.apiKey ?? "" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, kind: "network", error: String(err) };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: "auth", status: res.status, error: "Invalid or missing API key" };
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    return {
      ok: false,
      kind: "rate-limit",
      status: 429,
      error: "Rate limit exceeded",
      retryAfterMs: retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined,
    };
  }
  if (res.status === 400) {
    const text = await res.text().catch(() => "bad request");
    return { ok: false, kind: "bad-request", status: 400, error: text };
  }
  if (!res.ok) {
    return { ok: false, kind: "server", status: res.status, error: `Server error ${res.status}` };
  }

  let body: RicoApiResponse;
  try {
    body = (await res.json()) as RicoApiResponse;
  } catch {
    return { ok: false, kind: "server", error: "Invalid JSON response" };
  }

  const s = body.summary;
  const sniperPct = s.totalHolders > 0 && s.sniperCount != null
    ? s.sniperCount / s.totalHolders
    : 0;

  const result: RicoResult = {
    mint,
    riskScore: s.riskScore,
    totalHolders: s.totalHolders,
    cabalCount: s.cabalCount,
    snipersDetected: s.snipersDetected,
    sniperPct,
    bundleClustersDetected: s.bundleClustersDetected,
    symbol: body.tokenMetadata?.symbol,
    name: body.tokenMetadata?.name,
    tokenSecurity: body.tokenSecurity,
    deployerFlags: deployerFlagsFrom(body.tokenSecurity),
    tier: body.tier,
    processingMs: body.processingMs,
  };

  return { ok: true, result };
}
