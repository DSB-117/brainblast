import { describe, it, expect, vi } from "vitest";
import { pollChainOnce, initialChainWatchState, type ChainWatchOpts } from "../src/watchChain.ts";

const PROGRAM = "BPFLoaderUpgradeab1e11111111111111111111111";

function sigFetch(signatures: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        jsonrpc: "2.0",
        id: 1,
        result: signatures.map((s, i) => ({ signature: s, slot: 100 + i, err: null })),
      }),
  }) as unknown as typeof fetch;
}

function opts(signatures: string[], authority: string | null): ChainWatchOpts {
  return {
    fetchImpl: sigFetch(signatures),
    probeAuthority: async () => ({ address: authority }),
  };
}

describe("pollChainOnce", () => {
  it("first poll establishes a baseline and emits watch_started only", async () => {
    const { events, state } = await pollChainOnce(PROGRAM, initialChainWatchState(), opts(["sigA", "sigB"], "Auth1"));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("watch_started");
    expect(state.initialized).toBe(true);
    expect(state.lastSignature).toBe("sigA");
    expect(state.baselineAuthority).toBe("Auth1");
  });

  it("emits new_activity when fresh signatures appear", async () => {
    const baseline = { lastSignature: "sigA", baselineAuthority: "Auth1", initialized: true };
    const { events } = await pollChainOnce(PROGRAM, baseline, opts(["sigC", "sigD"], "Auth1"));
    const activity = events.find((e) => e.type === "new_activity");
    expect(activity).toBeDefined();
    expect((activity as any).newCount).toBe(2);
    expect((activity as any).signatures).toContain("sigC");
  });

  it("emits no activity event when there are no new signatures", async () => {
    const baseline = { lastSignature: "sigA", baselineAuthority: "Auth1", initialized: true };
    const { events } = await pollChainOnce(PROGRAM, baseline, opts([], "Auth1"));
    expect(events.find((e) => e.type === "new_activity")).toBeUndefined();
  });

  it("emits authority_changed when the upgrade authority moves", async () => {
    const baseline = { lastSignature: "sigA", baselineAuthority: "Auth1", initialized: true };
    const { events, state } = await pollChainOnce(PROGRAM, baseline, opts([], "Auth2_NEW"));
    const change = events.find((e) => e.type === "authority_changed");
    expect(change).toBeDefined();
    expect((change as any).from).toBe("Auth1");
    expect((change as any).to).toBe("Auth2_NEW");
    expect(state.baselineAuthority).toBe("Auth2_NEW");
  });

  it("emits authority_changed when authority is renounced (→ null)", async () => {
    const baseline = { lastSignature: "sigA", baselineAuthority: "Auth1", initialized: true };
    const { events } = await pollChainOnce(PROGRAM, baseline, opts([], null));
    const change = events.find((e) => e.type === "authority_changed");
    expect((change as any).to).toBeNull();
  });

  it("emits poll_error when the signatures RPC fails", async () => {
    const failFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const { events } = await pollChainOnce(PROGRAM, initialChainWatchState(), { fetchImpl: failFetch });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("poll_error");
  });

  it("advances lastSignature across polls (no duplicate activity)", async () => {
    let state = initialChainWatchState();
    ({ state } = await pollChainOnce(PROGRAM, state, opts(["s1"], "Auth1")));
    expect(state.lastSignature).toBe("s1");
    ({ state } = await pollChainOnce(PROGRAM, state, opts(["s2"], "Auth1")));
    expect(state.lastSignature).toBe("s2");
  });
});
