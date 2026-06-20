import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeToken, deployerFlagsFrom, renderRicoText, type RicoResult } from "../src/ricomaps.ts";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function mockRico(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (k: string) => headers[k] ?? null },
    json: async () => body,
  } as unknown as Response);
}

const SUCCESS = {
  success: true,
  summary: {
    totalHolders: 100,
    cabalCount: 4,
    riskScore: 82,
    snipersDetected: 25,
    bundleClustersDetected: 3,
    holderQuality: "poor",
  },
  tokenMetadata: { symbol: "SCAM", name: "Scammy" },
  tokenSecurity: {
    hasMintAuthority: true,
    mintAuthority: "Aaa",
    hasFreezeAuthority: false,
    isMutable: true,
    riskLevel: "high",
    riskFactors: ["Top 10 holders own 60%"],
  },
  tier: "free",
  processingMs: 1234,
};

describe("analyzeToken", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes a successful response", async () => {
    mockRico(SUCCESS);
    const out = await analyzeToken(MINT, { apiKey: "k" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.riskScore).toBe(82);
    expect(out.result.sniperPct).toBe(25); // 25/100
    expect(out.result.cabalCount).toBe(4);
    expect(out.result.bundleClustersDetected).toBe(3);
    expect(out.result.symbol).toBe("SCAM");
    expect(out.result.deployerFlags.some((f) => f.includes("Mint authority ACTIVE"))).toBe(true);
    expect(out.result.deployerFlags.some((f) => f.includes("MUTABLE"))).toBe(true);
    expect(out.result.deployerFlags).toContain("Top 10 holders own 60%");
  });

  it("returns kind=auth on 401 (graceful-skip signal)", async () => {
    mockRico({ success: false, error: "unauthorized" }, 401);
    const out = await analyzeToken(MINT);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("auth");
  });

  it("returns kind=rate-limit with retryAfterMs on 429", async () => {
    mockRico({ success: false }, 429, { "Retry-After": "30" });
    const out = await analyzeToken(MINT, { apiKey: "k" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("rate-limit");
    expect(out.retryAfterMs).toBe(30000);
  });

  it("returns kind=bad-request on 400", async () => {
    mockRico({ success: false }, 400);
    const out = await analyzeToken("bad", { apiKey: "k" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("bad-request");
  });

  it("returns kind=network when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await analyzeToken(MINT, { apiKey: "k" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("network");
  });
});

describe("deployerFlagsFrom", () => {
  it("returns no flags for a clean token", () => {
    const flags = deployerFlagsFrom({ hasMintAuthority: false, hasFreezeAuthority: false, isMutable: false });
    expect(flags).toEqual([]);
  });
  it("flags freeze authority", () => {
    const flags = deployerFlagsFrom({ hasMintAuthority: false, hasFreezeAuthority: true, isMutable: false });
    expect(flags.some((f) => f.includes("Freeze authority ACTIVE"))).toBe(true);
  });
});

describe("renderRicoText", () => {
  it("includes the headline signals", () => {
    const r: RicoResult = {
      mint: MINT, riskScore: 82, totalHolders: 100, cabalCount: 4,
      snipersDetected: 25, sniperPct: 25, bundleClustersDetected: 3,
      deployerFlags: ["Mint authority ACTIVE"],
    };
    const text = renderRicoText(r);
    expect(text).toContain("82/100");
    expect(text).toContain("25%");
    expect(text).toContain("Mint authority ACTIVE");
  });
});
