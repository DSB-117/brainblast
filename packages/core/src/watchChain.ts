// Live on-chain program monitoring.
//
// Moves brainblast from "before you ship" to "while it's live." Polls a deployed
// program's recent activity and upgrade authority and emits an anomaly stream:
// an unexpected upgrade-authority change (the single most dangerous on-chain
// event for a program's users) and bursts of new activity.
//
// Poll-based by design — no websocket dependency, fully testable via a single
// `pollChainOnce` cycle with an injected fetch. The daemon loop is a thin
// wrapper that calls it on an interval and emits NDJSON, mirroring `watch.ts`.

import { probeUpgradeAuthority, DEFAULT_RPC, type RpcOpts } from "./trustGraph/rpc.ts";

export type ChainEvent =
  | { type: "watch_started"; programId: string; headSignature: string | null; baselineAuthority: string | null; ts: string }
  | { type: "new_activity"; programId: string; newCount: number; signatures: string[]; ts: string }
  | { type: "authority_changed"; programId: string; from: string | null; to: string | null; ts: string }
  | { type: "poll_error"; programId: string; message: string; ts: string };

export interface ChainWatchState {
  lastSignature: string | null;
  baselineAuthority: string | null;
  initialized: boolean;
}

export interface ChainWatchOpts extends RpcOpts {
  limit?: number; // max signatures to fetch per poll (default 25)
  intervalMs?: number; // daemon poll interval (default 30s)
  emit?: (e: ChainEvent) => void;
  // Injection seam for the upgrade-authority probe. Defaults to the live
  // trust-graph RPC probe; tests override it to control authority transitions
  // without hand-crafting BPF-loader account byte layouts.
  probeAuthority?: (programId: string, opts: RpcOpts) => Promise<{ address: string | null }>;
}

interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime?: number | null;
}

async function getSignaturesForAddress(
  programId: string,
  until: string | null,
  opts: ChainWatchOpts,
): Promise<SignatureInfo[]> {
  const url = opts.rpcUrl ?? DEFAULT_RPC;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params: any[] = [programId, { limit: opts.limit ?? 25 }];
  if (until) params[1].until = until;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`getSignaturesForAddress: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: SignatureInfo[]; error?: { message: string } };
    if (body.error) throw new Error(`getSignaturesForAddress: ${body.error.message}`);
    return body.result ?? [];
  } finally {
    clearTimeout(t);
  }
}

// One poll cycle. Pure with respect to its inputs + injected fetch: returns the
// events observed and the updated state to feed into the next cycle. This is the
// unit the daemon loops on and the unit tests exercise directly.
export async function pollChainOnce(
  programId: string,
  state: ChainWatchState,
  opts: ChainWatchOpts = {},
): Promise<{ events: ChainEvent[]; state: ChainWatchState }> {
  const events: ChainEvent[] = [];
  const ts = () => new Date().toISOString();

  let sigs: SignatureInfo[];
  try {
    sigs = await getSignaturesForAddress(programId, state.lastSignature, opts);
  } catch (e: any) {
    events.push({ type: "poll_error", programId, message: e?.message ?? String(e), ts: ts() });
    return { events, state };
  }

  // Resolve current upgrade authority (best-effort; a probe error is non-fatal).
  const probe = opts.probeAuthority ?? ((id, o) => probeUpgradeAuthority(id, o).then((ua) => ({ address: ua.address })));
  let currentAuthority: string | null = state.baselineAuthority;
  try {
    const ua = await probe(programId, opts);
    currentAuthority = ua.address;
  } catch (e: any) {
    events.push({ type: "poll_error", programId, message: `authority probe: ${e?.message ?? String(e)}`, ts: ts() });
  }

  if (!state.initialized) {
    // First poll establishes the baseline; no activity/authority events yet.
    const head = sigs[0]?.signature ?? null;
    events.push({ type: "watch_started", programId, headSignature: head, baselineAuthority: currentAuthority, ts: ts() });
    return {
      events,
      state: { lastSignature: head, baselineAuthority: currentAuthority, initialized: true },
    };
  }

  // New signatures (getSignaturesForAddress with `until` returns only those
  // newer than lastSignature, newest first).
  if (sigs.length > 0) {
    events.push({
      type: "new_activity",
      programId,
      newCount: sigs.length,
      signatures: sigs.slice(0, 10).map((s) => s.signature),
      ts: ts(),
    });
  }

  // Authority change — the headline anomaly.
  if (currentAuthority !== state.baselineAuthority) {
    events.push({
      type: "authority_changed",
      programId,
      from: state.baselineAuthority,
      to: currentAuthority,
      ts: ts(),
    });
  }

  return {
    events,
    state: {
      lastSignature: sigs[0]?.signature ?? state.lastSignature,
      baselineAuthority: currentAuthority,
      initialized: true,
    },
  };
}

export function initialChainWatchState(): ChainWatchState {
  return { lastSignature: null, baselineAuthority: null, initialized: false };
}

// Daemon loop: polls on an interval and emits NDJSON. Returns a stop handle.
export function startChainWatch(programId: string, opts: ChainWatchOpts = {}): { stop: () => void } {
  const emit = opts.emit ?? ((e: ChainEvent) => process.stdout.write(JSON.stringify(e) + "\n"));
  const intervalMs = opts.intervalMs ?? 30_000;
  let state = initialChainWatchState();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    const { events, state: next } = await pollChainOnce(programId, state, opts);
    state = next;
    for (const e of events) emit(e);
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
