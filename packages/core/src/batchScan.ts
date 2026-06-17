// Batch token risk scanner.
//
// Pass a list of contract addresses — a portfolio, a launchpad's listings, a
// DEX routing whitelist — and get back a parallel-processed, risk-ranked matrix:
// identity status, impersonation flag, Rico risk score, snipers, bundle
// clusters, deployer flags. Built for builders curating which tokens their app
// should support.

import { verifyTokenIdentity, type IdentityStatus } from "./tokenRegistry.ts";
import { analyzeToken } from "./ricomaps.ts";

export interface BatchRow {
  mint: string;
  identityStatus: IdentityStatus | "error";
  impersonation: boolean;
  symbol?: string;
  riskScore?: number;
  snipers?: boolean;
  bundleClusters?: boolean;
  deployerFlags?: string[];
  error?: string;
  // Sort key (higher = riskier). Impersonators rank above everything; then by
  // Rico risk score; tokens with no score rank below scored ones.
  rank: number;
}

export interface BatchResult {
  rows: BatchRow[];
  summary: { total: number; impersonators: number; highRisk: number; errored: number };
}

export interface BatchScanOpts {
  apiKey?: string;
  ricoBaseUrl?: string;
  jupBaseUrl?: string;
  offline?: boolean;
  concurrency?: number; // default 5
  failOnRisk?: number; // for summary.highRisk count (default 70)
}

// Bounded-concurrency map. Preserves input order in the output array.
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function scanOne(mint: string, opts: BatchScanOpts): Promise<BatchRow> {
  const failOn = opts.failOnRisk ?? 70;
  try {
    const identity = await verifyTokenIdentity(mint, { baseUrl: opts.jupBaseUrl, offline: opts.offline });
    const row: BatchRow = {
      mint,
      identityStatus: identity.status,
      impersonation: identity.impersonation,
      symbol: identity.symbol,
      rank: 0,
    };

    if (!opts.offline) {
      const outcome = await analyzeToken(mint, { apiKey: opts.apiKey, baseUrl: opts.ricoBaseUrl });
      if (outcome.ok) {
        const q = outcome.result;
        row.riskScore = q.riskScore;
        row.snipers = q.snipersDetected;
        row.bundleClusters = q.bundleClustersDetected;
        row.deployerFlags = q.deployerFlags;
        if (!row.symbol) row.symbol = q.symbol;
      }
    }

    // Rank: impersonators float to the top (+1000), then by risk score; tokens
    // with no score sit at the bottom (-1).
    row.rank = (row.impersonation ? 1000 : 0) + (row.riskScore ?? -1);
    return row;
  } catch (e: any) {
    return { mint, identityStatus: "error", impersonation: false, error: e?.message ?? String(e), rank: -2 };
  }
}

export async function batchScan(mints: string[], opts: BatchScanOpts = {}): Promise<BatchResult> {
  const failOn = opts.failOnRisk ?? 70;
  const unique = [...new Set(mints.map((m) => m.trim()).filter(Boolean))];
  const rows = await mapPool(unique, opts.concurrency ?? 5, (m) => scanOne(m, opts));

  rows.sort((a, b) => b.rank - a.rank);

  const summary = {
    total: rows.length,
    impersonators: rows.filter((r) => r.impersonation).length,
    highRisk: rows.filter((r) => (r.riskScore ?? -1) >= failOn).length,
    errored: rows.filter((r) => r.identityStatus === "error").length,
  };

  return { rows, summary };
}

// Parse a CA list file: either a JSON array of strings or newline-separated
// addresses (with optional `#` comments).
export function parseMintList(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("JSON mint list must be an array of strings");
    return arr.map((x) => String(x));
  }
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

// ── Rendering ────────────────────────────────────────────────────────────────
function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

export function renderBatchText(result: BatchResult): string {
  const lines: string[] = [];
  lines.push(`Batch token scan — ${result.summary.total} token(s)`);
  lines.push(
    `  ${result.summary.impersonators} impersonator(s), ${result.summary.highRisk} high-risk, ${result.summary.errored} error(s)`,
  );
  lines.push("");
  lines.push(`  ${pad("MINT", 14)} ${pad("SYMBOL", 8)} ${pad("IDENTITY", 18)} ${pad("RISK", 5)} FLAGS`);
  for (const r of result.rows) {
    const mintShort = r.mint.length > 12 ? r.mint.slice(0, 6) + ".." + r.mint.slice(-4) : r.mint;
    const flags: string[] = [];
    if (r.impersonation) flags.push("IMPERSONATION");
    if (r.snipers) flags.push("snipers");
    if (r.bundleClusters) flags.push("bundle");
    if (r.error) flags.push(`error:${r.error}`);
    lines.push(
      `  ${pad(mintShort, 14)} ${pad(r.symbol ?? "-", 8)} ${pad(r.identityStatus, 18)} ${pad(r.riskScore != null ? String(r.riskScore) : "-", 5)} ${flags.join(", ")}`,
    );
  }
  return lines.join("\n");
}
