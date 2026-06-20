import { isValidSolanaAddress } from "./trustGraph/base58.ts";
import { DEFAULT_RPC, type RpcOpts } from "./trustGraph/rpc.ts";

// ── Oracle freshness (v0.7.4 — Live On-Chain Intelligence) ────────────────────
//
// "Is the oracle fresh?" is a question Solana devs answer by hand on Solscan:
// open the price account, look at when it was last written, decide whether
// that's recent enough to trust. A stale oracle is how protocols get drained
// at the wrong price.
//
// This check is deliberately *provider-agnostic*. Rather than parse Pyth's or
// Switchboard's (version-specific, easy-to-get-wrong) binary account layouts,
// it measures the one universal signal: when was the account last written?
// The most recent transaction that touched the account ≈ its last update.
//
//   freshness = currentSlot − slot(most recent signature touching the account)
//
// Works for Pyth, Switchboard, Chainlink, or any account whose "freshness"
// means "was written recently." For layout-specific publish-time semantics,
// pair this with the provider SDK — but for a fast trust gate, last-write
// recency is the right, robust primitive.

// Solana targets ~400ms/slot. Used only to translate a seconds threshold into
// slots and to estimate secondsBehind when blockTime is unavailable.
const SLOT_MS = 400;

// Default: an oracle not written in ~60s (150 slots) is treated as stale. Most
// production price feeds update every slot or few; 60s is a generous floor.
export const DEFAULT_STALENESS_SLOTS = 150;

export type OracleVerdict = "FRESH" | "STALE" | "NO_HISTORY";

export interface OracleFreshness {
  account: string;
  currentSlot: number;
  /** Slot of the most recent signature touching the account; null if none. */
  lastSlot: number | null;
  /** Unix seconds of that signature's block, when the RPC provides it. */
  lastBlockTime: number | null;
  slotsBehind: number | null;
  secondsBehind: number | null;
  thresholdSlots: number;
  fresh: boolean;
  verdict: OracleVerdict;
  checkedAt: string;
}

export interface OracleOpts extends RpcOpts {
  /** Staleness threshold in slots (default 150 ≈ 60s). */
  maxStalenessSlots?: number;
  /** Staleness threshold in seconds; converted to slots (~400ms each). */
  maxStalenessSeconds?: number;
}

async function rpc<T>(method: string, params: any[], opts: RpcOpts): Promise<T> {
  const url = opts.rpcUrl ?? DEFAULT_RPC;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
    if (body.result === undefined) throw new Error(`rpc ${method}: empty result`);
    return body.result;
  } finally {
    clearTimeout(t);
  }
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime?: number | null;
  err: unknown;
}

export async function checkOracleFreshness(
  account: string,
  opts: OracleOpts = {},
): Promise<OracleFreshness> {
  if (!isValidSolanaAddress(account)) throw new Error(`invalid Solana address: ${account}`);

  const thresholdSlots =
    opts.maxStalenessSlots ??
    (opts.maxStalenessSeconds != null
      ? Math.max(1, Math.round((opts.maxStalenessSeconds * 1000) / SLOT_MS))
      : DEFAULT_STALENESS_SLOTS);

  const checkedAt = new Date().toISOString();

  const currentSlot = await rpc<number>("getSlot", [{ commitment: "confirmed" }], opts);
  const sigs = await rpc<SignatureInfo[]>(
    "getSignaturesForAddress",
    [account, { limit: 1 }],
    opts,
  );

  if (!sigs || sigs.length === 0) {
    return {
      account,
      currentSlot,
      lastSlot: null,
      lastBlockTime: null,
      slotsBehind: null,
      secondsBehind: null,
      thresholdSlots,
      fresh: false,
      verdict: "NO_HISTORY",
      checkedAt,
    };
  }

  const last = sigs[0];
  const lastSlot = last.slot;
  const lastBlockTime = last.blockTime ?? null;
  const slotsBehind = Math.max(0, currentSlot - lastSlot);
  const secondsBehind =
    lastBlockTime != null
      ? Math.max(0, Math.floor(Date.now() / 1000) - lastBlockTime)
      : Math.round((slotsBehind * SLOT_MS) / 1000);

  const fresh = slotsBehind <= thresholdSlots;

  return {
    account,
    currentSlot,
    lastSlot,
    lastBlockTime,
    slotsBehind,
    secondsBehind,
    thresholdSlots,
    fresh,
    verdict: fresh ? "FRESH" : "STALE",
    checkedAt,
  };
}

// ── Renderers ─────────────────────────────────────────────────────────────────

export function renderOracleText(f: OracleFreshness): string {
  const L: string[] = [];
  L.push("── Oracle Freshness ──────────────────────────────────────────");
  L.push(`  account:       ${f.account}`);
  L.push(`  current slot:  ${f.currentSlot.toLocaleString()}`);
  if (f.verdict === "NO_HISTORY") {
    L.push("  last write:    (no transactions found touching this account)");
    L.push("  verdict:       ❓ NO_HISTORY — cannot confirm freshness");
    return L.join("\n");
  }
  L.push(`  last write:    slot ${f.lastSlot!.toLocaleString()} (${f.slotsBehind!.toLocaleString()} slots / ~${f.secondsBehind}s ago)`);
  L.push(`  threshold:     ${f.thresholdSlots.toLocaleString()} slots`);
  L.push(`  verdict:       ${f.fresh ? "✅ FRESH" : "🚨 STALE — last update is older than the freshness threshold"}`);
  return L.join("\n");
}

export function renderOracleMd(f: OracleFreshness): string {
  const L: string[] = ["## Oracle Freshness\n"];
  L.push(`**Account:** \`${f.account}\`  ·  checked ${f.checkedAt}\n`);
  if (f.verdict === "NO_HISTORY") {
    L.push("❓ **NO_HISTORY** — no transactions were found touching this account, so freshness can't be confirmed. Double-check the address.");
    return L.join("\n");
  }
  const badge = f.fresh ? "✅ **FRESH**" : "🚨 **STALE**";
  L.push(`${badge} — last written at slot ${f.lastSlot!.toLocaleString()}, ${f.slotsBehind!.toLocaleString()} slots (~${f.secondsBehind}s) behind the current slot (${f.currentSlot.toLocaleString()}).`);
  L.push("");
  L.push(`Threshold: ${f.thresholdSlots.toLocaleString()} slots. ${f.fresh ? "Within tolerance." : "**Exceeds tolerance — do not price against this feed until it updates.**"}`);
  return L.join("\n");
}
