import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeToken, deployerFlagsFrom, renderRicoText } from "../src/ricomaps.ts";
import type { RicoTokenSecurity } from "../src/ricomaps.ts";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const responseHeaders = new Headers(headers);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: responseHeaders,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("analyzeToken", () => {
  it("normalizes a successful response", async () => {
    mockFetch(200, {
      summary: {
        totalHolders: 1000,
        cabalCount: 10,
        riskScore: 35,
        snipersDetected: true,
        bundleClustersDetected: false,
        sniperCount: 50,
      },
      tokenSecurity: { hasMintAuthority: false, hasFreezeAuthority: false, isMutable: false },
      tokenMetadata: { symbol: "TEST", name: "Test Token" },
      tier: "standard",
      processingMs: 120,
    });

    const outcome = await analyzeToken("SomeMint1111111111111111111111111111111111111");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.result.riskScore).toBe(35);
    expect(outcome.result.totalHolders).toBe(1000);
    expect(outcome.result.snipersDetected).toBe(true);
    expect(outcome.result.sniperPct).toBeCloseTo(0.05);
    expect(outcome.result.symbol).toBe("TEST");
  });

  it("returns auth on 401", async () => {
    mockFetch(401, { error: "unauthorized" });
    const outcome = await analyzeToken("mint");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected error");
    expect(outcome.kind).toBe("auth");
  });

  it("returns auth on 403", async () => {
    mockFetch(403, { error: "forbidden" });
    const outcome = await analyzeToken("mint");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected error");
    expect(outcome.kind).toBe("auth");
  });

  it("returns rate-limit with retryAfterMs on 429", async () => {
    mockFetch(429, {}, { "Retry-After": "30" });
    const outcome = await analyzeToken("mint");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected error");
    expect(outcome.kind).toBe("rate-limit");
    expect(outcome.retryAfterMs).toBe(30_000);
  });

  it("returns bad-request on 400", async () => {
    mockFetch(400, "invalid mint");
    const outcome = await analyzeToken("bad");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected error");
    expect(outcome.kind).toBe("bad-request");
  });

  it("returns network error on fetch throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const outcome = await analyzeToken("mint");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected error");
    expect(outcome.kind).toBe("network");
  });
});

describe("deployerFlagsFrom", () => {
  it("converts security fields to flag strings", () => {
    const sec: RicoTokenSecurity = {
      hasMintAuthority: true,
      hasFreezeAuthority: false,
      isMutable: true,
      riskFactors: ["large-holder"],
    };
    const flags = deployerFlagsFrom(sec);
    expect(flags).toContain("mint-authority-live");
    expect(flags).not.toContain("freeze-authority-live");
    expect(flags).toContain("metadata-mutable");
    expect(flags).toContain("large-holder");
  });

  it("returns empty array for undefined", () => {
    expect(deployerFlagsFrom(undefined)).toEqual([]);
  });
});

describe("renderRicoText", () => {
  it("includes key fields", () => {
    const text = renderRicoText({
      mint: "ABC",
      riskScore: 42,
      totalHolders: 500,
      cabalCount: 5,
      snipersDetected: false,
      sniperPct: 0,
      bundleClustersDetected: true,
      deployerFlags: ["mint-authority-live"],
    });
    expect(text).toContain("42/100");
    expect(text).toContain("500");
    expect(text).toContain("Bundle clusters: detected");
    expect(text).toContain("mint-authority-live");
  });
});
