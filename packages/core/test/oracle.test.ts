import { describe, it, expect } from "vitest";
import {
  checkOracleFreshness,
  renderOracleText,
  renderOracleMd,
  DEFAULT_STALENESS_SLOTS,
} from "../src/oracle.ts";

const ACCT = "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG"; // valid base58 length

// Mock fetch answering getSlot + getSignaturesForAddress.
function mockFetch(opts: { slot: number; sigs: Array<{ slot: number; blockTime?: number | null }> }) {
  return (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (body.method === "getSlot") {
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: opts.slot }) } as any;
    }
    if (body.method === "getSignaturesForAddress") {
      const result = opts.sigs.map((s, i) => ({ signature: `sig${i}`, slot: s.slot, blockTime: s.blockTime ?? null, err: null }));
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) } as any;
    }
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "unexpected" } }) } as any;
  }) as any;
}

describe("checkOracleFreshness", () => {
  it("FRESH when the last write is within the slot threshold", async () => {
    const f = await checkOracleFreshness(ACCT, {
      fetchImpl: mockFetch({ slot: 1000, sigs: [{ slot: 980 }] }),
    });
    expect(f.verdict).toBe("FRESH");
    expect(f.fresh).toBe(true);
    expect(f.slotsBehind).toBe(20);
    expect(f.thresholdSlots).toBe(DEFAULT_STALENESS_SLOTS);
  });

  it("STALE when the last write is older than the threshold", async () => {
    const f = await checkOracleFreshness(ACCT, {
      fetchImpl: mockFetch({ slot: 100000, sigs: [{ slot: 90000 }] }),
    });
    expect(f.verdict).toBe("STALE");
    expect(f.fresh).toBe(false);
    expect(f.slotsBehind).toBe(10000);
  });

  it("NO_HISTORY when no signatures touch the account", async () => {
    const f = await checkOracleFreshness(ACCT, {
      fetchImpl: mockFetch({ slot: 1000, sigs: [] }),
    });
    expect(f.verdict).toBe("NO_HISTORY");
    expect(f.fresh).toBe(false);
    expect(f.lastSlot).toBeNull();
  });

  it("honors a custom --max-staleness-slots", async () => {
    const f = await checkOracleFreshness(ACCT, {
      maxStalenessSlots: 10,
      fetchImpl: mockFetch({ slot: 1000, sigs: [{ slot: 980 }] }),
    });
    expect(f.thresholdSlots).toBe(10);
    expect(f.verdict).toBe("STALE"); // 20 slots behind > 10
  });

  it("converts a seconds threshold to slots (~400ms/slot)", async () => {
    const f = await checkOracleFreshness(ACCT, {
      maxStalenessSeconds: 60,
      fetchImpl: mockFetch({ slot: 1000, sigs: [{ slot: 999 }] }),
    });
    expect(f.thresholdSlots).toBe(150); // 60s / 0.4s
  });

  it("prefers blockTime for secondsBehind when present", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const f = await checkOracleFreshness(ACCT, {
      fetchImpl: mockFetch({ slot: 1000, sigs: [{ slot: 995, blockTime: nowSec - 5 }] }),
    });
    expect(f.secondsBehind).toBeGreaterThanOrEqual(4);
    expect(f.secondsBehind).toBeLessThanOrEqual(7);
  });

  it("rejects an invalid address", async () => {
    await expect(checkOracleFreshness("not-an-address", {})).rejects.toThrow(/invalid Solana address/);
  });
});

describe("oracle renderers", () => {
  it("text render shows FRESH/STALE verdict", async () => {
    const fresh = await checkOracleFreshness(ACCT, { fetchImpl: mockFetch({ slot: 1000, sigs: [{ slot: 990 }] }) });
    expect(renderOracleText(fresh)).toContain("FRESH");
    const stale = await checkOracleFreshness(ACCT, { fetchImpl: mockFetch({ slot: 100000, sigs: [{ slot: 1 }] }) });
    expect(renderOracleText(stale)).toContain("STALE");
  });

  it("markdown render flags STALE with a do-not-price warning", async () => {
    const stale = await checkOracleFreshness(ACCT, { fetchImpl: mockFetch({ slot: 100000, sigs: [{ slot: 1 }] }) });
    const md = renderOracleMd(stale);
    expect(md).toContain("STALE");
    expect(md).toContain("do not price");
  });

  it("markdown render handles NO_HISTORY", async () => {
    const f = await checkOracleFreshness(ACCT, { fetchImpl: mockFetch({ slot: 1000, sigs: [] }) });
    expect(renderOracleMd(f)).toContain("NO_HISTORY");
  });
});
