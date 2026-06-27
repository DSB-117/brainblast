import { describe, it, expect } from "vitest";
import { selectFeed, tierForBrain, TIER_ENTITLEMENTS, type FeedTier } from "../src/feed.ts";
import type { CorpusVti } from "../src/corpus.ts";

function vti(over: Partial<CorpusVti> & { trapId: string; capturedAt: string }): CorpusVti {
  return {
    sdk: { name: "@solana/web3.js" },
    severity: "high",
    class: "silent-zero-revenue",
    corroborationCount: 0,
    redGreenProof: { red: true, green: true, method: "static-checker", verifiedAt: over.capturedAt } as any,
    vulnerable: { snippet: "VULN", lang: "typescript" } as any,
    fixed: { snippet: "FIXED", lang: "typescript" } as any,
    provenance: { sourceUrls: ["https://docs.example/x"] } as any,
    license: "synthetic-owned",
    ...over,
  };
}

// A fixed "now" far in the future so nothing is held back by freshness unless a
// test sets capturedAt close to it.
const NOW = "2030-01-01T00:00:00.000Z";

describe("VTI feed — tier eligibility from $BRAIN", () => {
  it("maps held $BRAIN to the right tier", () => {
    expect(tierForBrain(0)).toBe("sample");
    expect(tierForBrain(999)).toBe("sample");
    expect(tierForBrain(1_000)).toBe("standard");
    expect(tierForBrain(9_999)).toBe("standard");
    expect(tierForBrain(10_000)).toBe("firehose");
    expect(tierForBrain(1_000_000)).toBe("firehose");
  });
});

describe("VTI feed — what gets emitted", () => {
  const corpus = [
    vti({ trapId: "a", capturedAt: "2026-01-01T00:00:00.000Z" }),
    vti({ trapId: "b", capturedAt: "2026-02-01T00:00:00.000Z" }),
    vti({ trapId: "c", capturedAt: "2026-03-01T00:00:00.000Z" }),
  ];

  it("only emits RED→GREEN-proven records (an unproven VTI is not sellable)", () => {
    const withUnproven = [...corpus, vti({ trapId: "bad", capturedAt: "2026-04-01T00:00:00.000Z", redGreenProof: { red: true, green: false } as any })];
    const r = selectFeed(withUnproven, { now: NOW }, "firehose");
    expect(r.records.map((x) => x.trapId)).not.toContain("bad");
    expect(r.records).toHaveLength(3);
  });

  it("every record carries its RED→GREEN receipt (the proof)", () => {
    const r = selectFeed(corpus, { now: NOW }, "firehose");
    for (const rec of r.records) {
      expect(rec.receipt.red).toBe(true);
      expect(rec.receipt.green).toBe(true);
      expect(rec.receipt.method).toBe("static-checker");
    }
  });

  it("sample tier withholds the trainable fixtures (metadata + receipt only)", () => {
    const r = selectFeed(corpus, { now: NOW }, "sample");
    for (const rec of r.records) {
      expect(rec.fixtures).toBeUndefined();
      expect(rec.receipt.green).toBe(true); // still proves we have it
      expect(rec.sourceUrls.length).toBeGreaterThan(0);
    }
  });

  it("paid tiers include the vulnerable/fixed payload", () => {
    for (const tier of ["standard", "firehose"] as FeedTier[]) {
      const r = selectFeed(corpus, { now: NOW }, tier);
      expect(r.records[0].fixtures?.vulnerable?.snippet).toBe("VULN");
      expect(r.records[0].fixtures?.fixed?.snippet).toBe("FIXED");
    }
  });

  it("caps the record count at the tier limit", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      vti({ trapId: `t${i}`, capturedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const sampleCap = TIER_ENTITLEMENTS.sample.maxRecords as number;
    const r = selectFeed(many, { now: NOW }, "sample");
    expect(r.records).toHaveLength(sampleCap);
    expect(r.counts.capped).toBe(20 - sampleCap);
  });
});

describe("VTI feed — the delta (cursor) + filters", () => {
  const corpus = [
    vti({ trapId: "jan", capturedAt: "2026-01-01T00:00:00.000Z", sdk: { name: "@solana/web3.js" }, severity: "low", corroborationCount: 0 }),
    vti({ trapId: "feb", capturedAt: "2026-02-01T00:00:00.000Z", sdk: { name: "@meteora-ag/dlmm" }, severity: "critical", class: "missing-slippage-guard", corroborationCount: 4 }),
    vti({ trapId: "mar", capturedAt: "2026-03-01T00:00:00.000Z", sdk: { name: "@solana/web3.js" }, severity: "high", corroborationCount: 2 }),
  ];

  it("returns the resume cursor = the newest capturedAt emitted", () => {
    const r = selectFeed(corpus, { now: NOW }, "firehose");
    expect(r.cursor).toBe("2026-03-01T00:00:00.000Z");
    // Records stream oldest-first so the cursor advances monotonically.
    expect(r.records.map((x) => x.trapId)).toEqual(["jan", "feb", "mar"]);
  });

  it("--since returns only the delta and never re-sends a seen record", () => {
    const r = selectFeed(corpus, { since: "2026-02-01T00:00:00.000Z", now: NOW }, "firehose");
    expect(r.records.map((x) => x.trapId)).toEqual(["mar"]);
    // Resuming from the new cursor yields nothing further.
    const r2 = selectFeed(corpus, { since: r.cursor!, now: NOW }, "firehose");
    expect(r2.records).toHaveLength(0);
    expect(r2.cursor).toBe(r.cursor); // cursor holds steady when the delta is empty
  });

  it("filters by SDK substring, class, min-severity (and above), and corroboration", () => {
    expect(selectFeed(corpus, { sdk: "meteora", now: NOW }, "firehose").records.map((x) => x.trapId)).toEqual(["feb"]);
    expect(selectFeed(corpus, { class: "missing-slippage-guard", now: NOW }, "firehose").records.map((x) => x.trapId)).toEqual(["feb"]);
    // min-severity "high" includes high AND critical, not low.
    expect(selectFeed(corpus, { minSeverity: "high", now: NOW }, "firehose").records.map((x) => x.trapId).sort()).toEqual(["feb", "mar"]);
    expect(selectFeed(corpus, { minCorroboration: 3, now: NOW }, "firehose").records.map((x) => x.trapId)).toEqual(["feb"]);
  });
});

describe("VTI feed — freshness is the moat (holdback by tier)", () => {
  // A record captured 1 hour before "now".
  const fresh = vti({ trapId: "fresh", capturedAt: "2029-12-31T23:00:00.000Z" });
  const old = vti({ trapId: "old", capturedAt: "2026-01-01T00:00:00.000Z" });
  const corpus = [old, fresh];

  it("firehose gets the freshest record immediately (0h holdback)", () => {
    const r = selectFeed(corpus, { now: NOW }, "firehose");
    expect(r.records.map((x) => x.trapId).sort()).toEqual(["fresh", "old"]);
    expect(r.counts.heldBackFreshness).toBe(0);
  });

  it("lower tiers hold back the too-fresh record (and count it)", () => {
    const r = selectFeed(corpus, { now: NOW }, "standard"); // 24h holdback
    expect(r.records.map((x) => x.trapId)).toEqual(["old"]);
    expect(r.counts.heldBackFreshness).toBe(1);
    expect(r.counts.matchedQuery).toBe(2);
  });
});
