import { describe, it, expect, vi, beforeEach } from "vitest";
import { batchScan, parseMintList, renderBatchText } from "../src/batchScan.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // canonical (bundled)
const FAKE_IMPOSTER = "Fake1111111111111111111111111111111111111111";
const FAKE_RISKY = "Risk1111111111111111111111111111111111111111";

const JUP: Record<string, { symbol: string; name: string; address: string }> = {
  [FAKE_IMPOSTER]: { symbol: "USDC", name: "Fake USDC", address: FAKE_IMPOSTER },
  [FAKE_RISKY]: { symbol: "PEPE", name: "Pepe", address: FAKE_RISKY },
};
const RICO: Record<string, number> = { [USDC]: 10, [FAKE_IMPOSTER]: 30, [FAKE_RISKY]: 85 };

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: any) => {
      if (typeof url === "string" && url.includes("/token/")) {
        const mint = url.split("/token/")[1];
        const t = JUP[mint];
        if (!t) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(t) });
      }
      const body = JSON.parse(init.body);
      const score = RICO[body.mint] ?? 0;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            summary: { totalHolders: 100, cabalCount: 0, riskScore: score, snipersDetected: false, bundleClustersDetected: false, sniperCount: 0 },
            tokenMetadata: { symbol: "X", name: "X" },
          }),
      });
    }),
  );
}

describe("parseMintList", () => {
  it("parses a JSON array", () => {
    expect(parseMintList('["a", "b"]')).toEqual(["a", "b"]);
  });
  it("parses newline-separated with comments", () => {
    expect(parseMintList("a\n# comment\nb  # inline\n\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("batchScan", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("ranks impersonators above high-risk above clean tokens", async () => {
    stubFetch();
    const result = await batchScan([USDC, FAKE_IMPOSTER, FAKE_RISKY], { jupBaseUrl: "http://jup.test", ricoBaseUrl: "http://rico.test" });
    expect(result.rows[0].mint).toBe(FAKE_IMPOSTER); // impersonator floats to top
    expect(result.rows[0].impersonation).toBe(true);
    expect(result.rows[1].mint).toBe(FAKE_RISKY); // risk 85
    expect(result.rows[2].mint).toBe(USDC); // risk 10
  });

  it("computes a summary", async () => {
    stubFetch();
    const result = await batchScan([USDC, FAKE_IMPOSTER, FAKE_RISKY], { jupBaseUrl: "http://jup.test", ricoBaseUrl: "http://rico.test" });
    expect(result.summary.total).toBe(3);
    expect(result.summary.impersonators).toBe(1);
    expect(result.summary.highRisk).toBe(1); // FAKE_RISKY @ 85 >= 70
  });

  it("dedupes repeated addresses", async () => {
    stubFetch();
    const result = await batchScan([USDC, USDC, USDC], { jupBaseUrl: "http://jup.test", ricoBaseUrl: "http://rico.test" });
    expect(result.summary.total).toBe(1);
  });

  it("resolves canonical mints offline without network", async () => {
    // No fetch stub — offline path must not hit the network for a bundled mint.
    const result = await batchScan([USDC], { offline: true });
    expect(result.rows[0].identityStatus).toBe("verified-canonical");
    expect(result.rows[0].riskScore).toBeUndefined();
  });

  it("respects a concurrency limit (still scans all)", async () => {
    stubFetch();
    const result = await batchScan([USDC, FAKE_IMPOSTER, FAKE_RISKY], {
      concurrency: 1,
      jupBaseUrl: "http://jup.test",
      ricoBaseUrl: "http://rico.test",
    });
    expect(result.summary.total).toBe(3);
  });
});

describe("renderBatchText", () => {
  it("renders a header and rows", async () => {
    stubFetch();
    const result = await batchScan([FAKE_IMPOSTER], { jupBaseUrl: "http://jup.test", ricoBaseUrl: "http://rico.test" });
    const text = renderBatchText(result);
    expect(text).toContain("Batch token scan");
    expect(text).toContain("IMPERSONATION");
  });
});
