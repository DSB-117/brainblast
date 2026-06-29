import { describe, it, expect } from "vitest";
import {
  buildCatalog,
  issueGrant,
  verifyGrant,
  appendUsage,
  verifyLedger,
  summarizeUsage,
  canonicalJson,
  TIER_PRICING,
  LEDGER_GENESIS,
  type UsageEntry,
} from "../src/marketplace.ts";
import type { CorpusVti } from "../src/corpus.ts";

function vti(over: Partial<CorpusVti> & { trapId: string }): CorpusVti {
  return {
    sdk: { name: "@solana/web3.js" },
    severity: "high",
    class: "silent-zero-revenue",
    corroborationCount: 0,
    redGreenProof: { red: true, green: true, method: "static-checker", verifiedAt: "2026-01-01T00:00:00.000Z" } as any,
    vulnerable: { snippet: "VULN", lang: "typescript" } as any,
    fixed: { snippet: "FIXED", lang: "typescript" } as any,
    provenance: { sourceUrls: ["https://docs.example/x"] } as any,
    license: "synthetic-owned",
    capturedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const SECRET = "test-distributor-secret";
const NOW = "2026-06-29T00:00:00.000Z";

describe("canonicalJson — stable key order", () => {
  it("serializes identically regardless of construction order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1}}');
  });
});

describe("catalog — the storefront", () => {
  const corpus = [
    vti({ trapId: "a", sdk: { name: "@solana/web3.js" }, class: "silent-zero-revenue" }),
    vti({ trapId: "b", sdk: { name: "@meteora-ag/dlmm" }, class: "missing-slippage-guard", corroborationCount: 3 }),
    vti({ trapId: "c", sdk: { name: "Pyth" }, class: "unchecked-staleness", redGreenProof: { red: true, green: false } as any }),
  ];

  it("counts only proven records in coverage, but reports total", () => {
    const cat = buildCatalog(corpus, { now: NOW });
    expect(cat.counts.total).toBe(3);
    expect(cat.counts.proven).toBe(2); // c is not RED→GREEN
    expect(cat.counts.sdks).toBe(2);
    expect(cat.classDistribution["silent-zero-revenue"]).toBe(1);
    expect(cat.classDistribution["unchecked-staleness"]).toBeUndefined(); // unproven excluded
  });

  it("teasers are receipt-only — never the trainable fixtures — and survive freshness holdback", () => {
    const cat = buildCatalog(corpus, { now: NOW });
    expect(cat.teasers.length).toBeGreaterThan(0); // not emptied by the sample-tier holdback
    for (const t of cat.teasers) {
      expect(t.receipt.red).toBe(true);
      expect(t.receipt.green).toBe(true);
      expect((t as any).fixtures).toBeUndefined();
    }
  });

  it("publishes the three-tier price ladder", () => {
    const cat = buildCatalog(corpus, { now: NOW });
    expect(cat.tiers.map((t) => t.tier)).toEqual(["sample", "standard", "firehose"]);
    expect(cat.tiers[0].priceUsd).toBeNull(); // sample is free
    expect(TIER_PRICING.standard.brainDiscountPct).toBe(10);
  });
});

describe("grant — the distribution entitlement", () => {
  it("a freshly issued grant verifies", () => {
    const g = issueGrant({ buyer: "acme", tier: "standard", lots: [], secret: SECRET, ttlDays: 30, now: NOW });
    const v = verifyGrant(g, SECRET, NOW);
    expect(v.valid).toBe(true);
    expect(v.tier).toBe("standard");
    expect(v.buyer).toBe("acme");
  });

  it("rejects a forged tier — the buyer cannot self-upgrade", () => {
    const g = issueGrant({ buyer: "acme", tier: "sample", lots: [], secret: SECRET, ttlDays: 30, now: NOW });
    const tampered = { ...g, tier: "firehose" as const };
    const v = verifyGrant(tampered, SECRET, NOW);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("bad-signature");
  });

  it("rejects a grant signed with a different secret", () => {
    const g = issueGrant({ buyer: "acme", tier: "firehose", lots: [], secret: SECRET, ttlDays: 30, now: NOW });
    expect(verifyGrant(g, "wrong-secret", NOW).valid).toBe(false);
  });

  it("honors expiry", () => {
    const g = issueGrant({ buyer: "acme", tier: "standard", lots: [], secret: SECRET, ttlDays: 1, now: NOW });
    expect(verifyGrant(g, SECRET, "2026-06-29T12:00:00.000Z").valid).toBe(true); // within 1 day
    const v = verifyGrant(g, SECRET, "2026-07-05T00:00:00.000Z"); // past
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("ttlDays null = never expires", () => {
    const g = issueGrant({ buyer: "acme", tier: "standard", lots: [], secret: SECRET, ttlDays: null, now: NOW });
    expect(g.expiresAt).toBeNull();
    expect(verifyGrant(g, SECRET, "2099-01-01T00:00:00.000Z").valid).toBe(true);
  });

  it("flags malformed grants", () => {
    expect(verifyGrant({} as any, SECRET, NOW).reason).toBe("malformed");
  });
});

describe("metering ledger — hash-chained, tamper-evident", () => {
  function rec(buyer: string, tier: "sample" | "standard" | "firehose", n: number, ts: string) {
    return { ts, buyer, tier, lots: ["seed-vti.jsonl"], recordsServed: n, cursor: null };
  }

  it("chains entries from genesis and verifies end to end", () => {
    let ledger: UsageEntry[] = [];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 8, "2026-06-29T00:00:00Z"))];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 5, "2026-06-29T01:00:00Z"))];
    ledger = [...ledger, appendUsage(ledger, rec("globex", "firehose", 100, "2026-06-29T02:00:00Z"))];

    expect(ledger[0].prevHash).toBe(LEDGER_GENESIS);
    expect(ledger[0].seq).toBe(0);
    expect(ledger[1].prevHash).toBe(ledger[0].hash);
    expect(ledger[2].seq).toBe(2);
    expect(verifyLedger(ledger).valid).toBe(true);
  });

  it("detects a tampered record (bad-hash)", () => {
    let ledger: UsageEntry[] = [];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 8, "2026-06-29T00:00:00Z"))];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 5, "2026-06-29T01:00:00Z"))];
    // Inflate served count without re-hashing — the billing-fraud attempt.
    const evil = { ...ledger[0], recordsServed: 9999 };
    const v = verifyLedger([evil, ledger[1]]);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("bad-hash");
    expect(v.brokenAt).toBe(0);
  });

  it("detects a removed entry (broken chain)", () => {
    let ledger: UsageEntry[] = [];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 8, "2026-06-29T00:00:00Z"))];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 5, "2026-06-29T01:00:00Z"))];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 7, "2026-06-29T02:00:00Z"))];
    // Drop the middle entry: seq 0 then seq 2 — sequence breaks.
    const v = verifyLedger([ledger[0], ledger[2]]);
    expect(v.valid).toBe(false);
  });

  it("summarizes per-buyer usage", () => {
    let ledger: UsageEntry[] = [];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 8, "2026-06-29T00:00:00Z"))];
    ledger = [...ledger, appendUsage(ledger, rec("acme", "standard", 5, "2026-06-29T01:00:00Z"))];
    ledger = [...ledger, appendUsage(ledger, rec("globex", "firehose", 100, "2026-06-29T02:00:00Z"))];

    const sum = summarizeUsage(ledger);
    expect(sum[0].buyer).toBe("globex"); // sorted by recordsServed desc
    expect(sum[0].recordsServed).toBe(100);
    const acme = sum.find((s) => s.buyer === "acme")!;
    expect(acme.pulls).toBe(2);
    expect(acme.recordsServed).toBe(13);
    expect(acme.lastSeen).toBe("2026-06-29T01:00:00Z");
  });
});
