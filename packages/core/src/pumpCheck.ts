// Launch pre-flight for pump.fun / SPL token builders.
//
// Run this before you list or integrate a token: it reads the on-chain SPL mint
// account (are the mint and freeze authorities revoked?), verifies identity, and
// folds in a Rico Maps forensic scan (snipers, bundle clusters, holders, risk
// score) into one GO / CAUTION / NO-GO checklist.
//
// The single biggest silent footgun for a token integration is a *live mint
// authority* (the deployer can print unlimited supply) or a *live freeze
// authority* (they can freeze your users' tokens). Both are one getAccountInfo
// call away — this surfaces them up front.

import { getAccountInfo, type RpcOpts } from "./trustGraph/rpc.ts";
import { base58Encode } from "./trustGraph/base58.ts";
import { analyzeToken, type RicoResult } from "./ricomaps.ts";
import { verifyTokenIdentity, type TokenIdentity } from "./tokenRegistry.ts";

export type PreflightStatus = "pass" | "warn" | "fail" | "skip";
export type PreflightVerdict = "GO" | "CAUTION" | "NO-GO";

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
}

export interface MintInfo {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: string;
  decimals: number;
  isInitialized: boolean;
}

export interface PreflightReport {
  mint: string;
  verdict: PreflightVerdict;
  checks: PreflightCheck[];
  mintInfo?: MintInfo;
  identity?: TokenIdentity;
  quality?: RicoResult;
}

// ── SPL Mint account layout (82 bytes) ───────────────────────────────────────
//   0  ..4   mintAuthorityOption (u32 LE; 0 = none/revoked, 1 = present)
//   4  ..36  mintAuthority (Pubkey)
//   36 ..44  supply (u64 LE)
//   44       decimals (u8)
//   45       isInitialized (u8)
//   46 ..50  freezeAuthorityOption (u32 LE)
//   50 ..82  freezeAuthority (Pubkey)
function readU32LE(d: Uint8Array, o: number): number {
  return d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
}
function readU64LE(d: Uint8Array, o: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i]);
  return v;
}

export function parseMintAccount(data: Uint8Array): MintInfo {
  if (data.length < 82) throw new Error(`not an SPL mint account (got ${data.length} bytes, need ≥82)`);
  const mintAuthOption = readU32LE(data, 0);
  const freezeAuthOption = readU32LE(data, 46);
  return {
    mintAuthorityRevoked: mintAuthOption === 0,
    freezeAuthorityRevoked: freezeAuthOption === 0,
    mintAuthority: mintAuthOption === 1 ? base58Encode(data.subarray(4, 36)) : null,
    freezeAuthority: freezeAuthOption === 1 ? base58Encode(data.subarray(50, 82)) : null,
    supply: readU64LE(data, 36).toString(),
    decimals: data[44],
    isInitialized: data[45] === 1,
  };
}

export interface PreflightOpts extends RpcOpts {
  apiKey?: string; // Rico Maps key (optional)
  ricoBaseUrl?: string;
  jupBaseUrl?: string;
  offline?: boolean; // skip Rico + Jupiter network calls
  failOnRisk?: number; // risk score threshold (default 70)
}

function verdictFrom(checks: PreflightCheck[]): PreflightVerdict {
  if (checks.some((c) => c.status === "fail")) return "NO-GO";
  if (checks.some((c) => c.status === "warn")) return "CAUTION";
  return "GO";
}

export async function pumpPreflight(mint: string, opts: PreflightOpts = {}): Promise<PreflightReport> {
  const failOnRisk = opts.failOnRisk ?? 70;
  const checks: PreflightCheck[] = [];
  const report: PreflightReport = { mint, verdict: "GO", checks };

  // ── On-chain mint authorities ───────────────────────────────────────────
  try {
    const acct = await getAccountInfo(mint, opts);
    if (!acct) {
      checks.push({ id: "mint-exists", label: "Mint account exists", status: "fail", detail: "No account found at this address on the selected cluster." });
    } else {
      const info = parseMintAccount(acct.data);
      report.mintInfo = info;
      checks.push({
        id: "mint-authority-revoked",
        label: "Mint authority revoked",
        status: info.mintAuthorityRevoked ? "pass" : "fail",
        detail: info.mintAuthorityRevoked
          ? "Mint authority is revoked — total supply is fixed."
          : `Mint authority is LIVE (${info.mintAuthority}). The holder can mint unlimited new supply and dilute every holder.`,
      });
      checks.push({
        id: "freeze-authority-revoked",
        label: "Freeze authority revoked",
        status: info.freezeAuthorityRevoked ? "pass" : "warn",
        detail: info.freezeAuthorityRevoked
          ? "Freeze authority is revoked — token accounts cannot be frozen."
          : `Freeze authority is LIVE (${info.freezeAuthority}). The holder can freeze any user's token account.`,
      });
    }
  } catch (e: any) {
    checks.push({ id: "mint-read", label: "Read mint account", status: "skip", detail: `Could not read mint account: ${e?.message ?? String(e)}` });
  }

  // ── Identity ────────────────────────────────────────────────────────────
  try {
    const identity = await verifyTokenIdentity(mint, { baseUrl: opts.jupBaseUrl, offline: opts.offline });
    report.identity = identity;
    checks.push({
      id: "identity",
      label: "Token identity",
      status: identity.impersonation ? "fail" : "pass",
      detail: identity.impersonation
        ? `Impersonation: claims symbol '${identity.symbol}' but the canonical mint is ${identity.canonicalMint}.`
        : `Identity: ${identity.status}${identity.symbol ? ` (${identity.symbol})` : ""}.`,
    });
  } catch (e: any) {
    checks.push({ id: "identity", label: "Token identity", status: "skip", detail: `Identity check failed: ${e?.message ?? String(e)}` });
  }

  // ── Rico Maps forensics ─────────────────────────────────────────────────
  if (!opts.offline) {
    const outcome = await analyzeToken(mint, { apiKey: opts.apiKey, baseUrl: opts.ricoBaseUrl });
    if (outcome.ok) {
      const q = outcome.result;
      report.quality = q;
      checks.push({
        id: "risk-score",
        label: "Rico risk score",
        status: q.riskScore >= failOnRisk ? "fail" : q.riskScore >= 40 ? "warn" : "pass",
        detail: `Rico risk score ${q.riskScore}/100 (threshold ${failOnRisk}).`,
      });
      checks.push({
        id: "snipers",
        label: "Sniper activity",
        status: q.snipersDetected ? "warn" : "pass",
        detail: q.snipersDetected ? `Snipers detected (${(q.sniperPct * 100).toFixed(1)}% of holders).` : "No snipers detected.",
      });
      checks.push({
        id: "bundle-clusters",
        label: "Bundle clusters",
        status: q.bundleClustersDetected ? "warn" : "pass",
        detail: q.bundleClustersDetected ? "Bundle launch clusters detected." : "No bundle clusters detected.",
      });
      checks.push({
        id: "holders",
        label: "Holder distribution",
        status: q.totalHolders < 50 ? "warn" : "pass",
        detail: `${q.totalHolders} holders${q.cabalCount ? `, ${q.cabalCount} cabal wallet(s)` : ""}.`,
      });
      if (q.deployerFlags.length) {
        checks.push({
          id: "deployer-flags",
          label: "Deployer flags",
          status: "warn",
          detail: `Deployer flags: ${q.deployerFlags.join(", ")}.`,
        });
      }
    } else {
      checks.push({
        id: "rico-scan",
        label: "Rico Maps scan",
        status: "skip",
        detail: `Quality scan skipped (${outcome.kind}): ${outcome.error}.`,
      });
    }
  } else {
    checks.push({ id: "rico-scan", label: "Rico Maps scan", status: "skip", detail: "Offline mode — quality scan skipped." });
  }

  report.verdict = verdictFrom(checks);
  return report;
}

// ── Rendering ────────────────────────────────────────────────────────────────
const STATUS_ICON: Record<PreflightStatus, string> = { pass: "✓", warn: "⚠", fail: "✗", skip: "·" };

export function renderPreflightText(r: PreflightReport): string {
  const lines: string[] = [];
  lines.push(`Launch pre-flight  [${r.verdict}]  ${r.mint}`);
  if (r.mintInfo) lines.push(`  Supply: ${r.mintInfo.supply}  Decimals: ${r.mintInfo.decimals}`);
  lines.push("");
  for (const c of r.checks) {
    lines.push(`  ${STATUS_ICON[c.status]} ${c.label} — ${c.detail}`);
  }
  return lines.join("\n");
}
