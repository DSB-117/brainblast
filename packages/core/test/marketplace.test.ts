import { describe, it, expect } from "vitest";
import {
  buildCatalog,
  issueGrant,
  verifyGrant,
  generateDistributorKeypair,
  addressFromSecretKey,
  appendUsage,
  verifyLedger,
  summarizeUsage,
  canonicalJson,
  accessQuote,
  TIER_PRICING,
  LEDGER_GENESIS,
  type UsageEntry,
  type GrantSigner,
  type GrantVerifier,
} from "../src/marketplace.ts";
import { base58Encode, base58Decode } from "../src/base58.ts";
import { createHmac } from "node:crypto";
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

describe("accessQuote — self-serve eligibility from $BRAIN held (R4)", () => {
  it("0 $BRAIN → sample (free, open), upgrade to standard short the full threshold", () => {
    const q = accessQuote(0);
    expect(q.tier).toBe("sample");
    expect(q.access).toBe("open");
    expect(q.priceUsd).toBeNull();
    expect(q.upgrade).toEqual({ tier: "standard", minBrain: 100_000, brainShort: 100_000 });
  });

  it("partial holding reports how much more buys the next tier", () => {
    const q = accessQuote(60_000);
    expect(q.tier).toBe("sample");
    expect(q.upgrade?.brainShort).toBe(40_000); // 100_000 - 60_000
  });

  it("crossing a threshold lands the tier", () => {
    expect(accessQuote(100_000).tier).toBe("standard");
    expect(accessQuote(999_999).tier).toBe("standard");
    expect(accessQuote(1_000_000).tier).toBe("firehose");
  });

  it("standard quotes its price + the firehose upgrade", () => {
    const q = accessQuote(150_000);
    expect(q.tier).toBe("standard");
    expect(q.priceUsd).toBe(TIER_PRICING.standard.priceUsd);
    expect(q.priceBrain).toBe(TIER_PRICING.standard.priceBrainUsdEquivalent);
    expect(q.upgrade).toEqual({ tier: "firehose", minBrain: 1_000_000, brainShort: 850_000 });
  });

  it("firehose is the top — no upgrade", () => {
    const q = accessQuote(5_000_000);
    expect(q.tier).toBe("firehose");
    expect(q.upgrade).toBeNull();
  });

  it("clamps junk input (negative / NaN) to 0 → sample", () => {
    expect(accessQuote(-100).tier).toBe("sample");
    expect(accessQuote(Number.NaN).tier).toBe("sample");
    expect(accessQuote(-100).brainHeld).toBe(0);
  });
});

describe("base58", () => {
  it("round-trips arbitrary bytes (incl. leading zeros)", () => {
    for (const hex of ["00", "0000ff", "deadbeef", "01".repeat(32)]) {
      const b = Buffer.from(hex, "hex");
      expect(base58Decode(base58Encode(b)).equals(b)).toBe(true);
    }
  });
  it("throws on a non-base58 char", () => {
    expect(() => base58Decode("0OIl")).toThrow(); // 0, O, I, l are not in the alphabet
  });
});

describe("grant — ed25519 (publicly verifiable, the multi-party foundation)", () => {
  const dist = generateDistributorKeypair();
  const signer: GrantSigner = { alg: "ed25519", secretKey: dist.secretKey };
  const verifier: GrantVerifier = { alg: "ed25519", publicKey: dist.address };

  it("keypair address matches the address derived from the secret key", () => {
    expect(addressFromSecretKey(dist.secretKey)).toBe(dist.address);
  });

  it("verifies with ONLY the distributor public key — no secret", () => {
    const g = issueGrant({ buyer: "acme", tier: "standard", lots: [], signer, ttlDays: 30, now: NOW });
    expect(g.alg).toBe("ed25519");
    expect(g.signer).toBe(dist.address);
    const v = verifyGrant(g, verifier, NOW);
    expect(v.valid).toBe(true);
    expect(v.tier).toBe("standard");
    expect(v.buyer).toBe("acme");
    expect(v.signer).toBe(dist.address);
  });

  it("rejects a forged tier — the buyer cannot self-upgrade", () => {
    const g = issueGrant({ buyer: "acme", tier: "sample", lots: [], signer, ttlDays: 30, now: NOW });
    const v = verifyGrant({ ...g, tier: "firehose" }, verifier, NOW);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("bad-signature");
  });

  it("rejects a grant from an UNTRUSTED distributor (different keypair)", () => {
    const other = generateDistributorKeypair();
    const g = issueGrant({ buyer: "acme", tier: "firehose", lots: [], signer: { alg: "ed25519", secretKey: other.secretKey }, ttlDays: 30, now: NOW });
    // We verify against OUR trusted address — the grant was signed by someone else.
    const v = verifyGrant(g, verifier, NOW);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("untrusted-signer");
  });

  it("rejects an attacker who rewrites `signer` to our address but keeps their sig", () => {
    const other = generateDistributorKeypair();
    const g = issueGrant({ buyer: "acme", tier: "firehose", lots: [], signer: { alg: "ed25519", secretKey: other.secretKey }, ttlDays: 30, now: NOW });
    const v = verifyGrant({ ...g, signer: dist.address }, verifier, NOW);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("bad-signature");
  });

  it("rejects an hmac verifier against an ed25519 grant (wrong-verifier)", () => {
    const g = issueGrant({ buyer: "acme", tier: "standard", lots: [], signer, ttlDays: 30, now: NOW });
    const v = verifyGrant(g, { alg: "hmac-sha256", secret: SECRET }, NOW);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("wrong-verifier");
  });

  it("honors expiry", () => {
    const g = issueGrant({ buyer: "acme", tier: "standard", lots: [], signer, ttlDays: 1, now: NOW });
    expect(verifyGrant(g, verifier, "2026-06-29T12:00:00.000Z").valid).toBe(true);
    expect(verifyGrant(g, verifier, "2026-07-05T00:00:00.000Z").reason).toBe("expired");
  });
});

describe("grant — legacy hmac (backward compat) + common", () => {
  const signer: GrantSigner = { alg: "hmac-sha256", secret: SECRET };
  const verifier: GrantVerifier = { alg: "hmac-sha256", secret: SECRET };

  it("a v0.9.5-style hmac grant still verifies", () => {
    const g = issueGrant({ buyer: "acme", tier: "standard", lots: [], signer, ttlDays: 30, now: NOW });
    expect(g.alg).toBe("hmac-sha256");
    expect(verifyGrant(g, verifier, NOW).valid).toBe(true);
  });

  it("verifies a genuine pre-R2 grant (no alg field, hmac over the bare payload)", () => {
    // Faithfully reconstruct what v0.9.5 wrote to disk: the payload + a hex hmac
    // over canonicalJson(payload), with NO alg/signer fields.
    const payload = {
      grantVersion: "1.0" as const,
      buyer: "acme",
      tier: "standard" as const,
      lots: [] as string[],
      issuedAt: NOW,
      expiresAt: null,
      nonce: "deadbeefdeadbeef",
    };
    const sig = createHmac("sha256", SECRET).update(canonicalJson(payload)).digest("hex");
    const legacy = { ...payload, sig };
    expect(verifyGrant(legacy as any, verifier, NOW).valid).toBe(true);
  });

  it("rejects a forged tier and a wrong secret", () => {
    const g = issueGrant({ buyer: "acme", tier: "sample", lots: [], signer, ttlDays: 30, now: NOW });
    expect(verifyGrant({ ...g, tier: "firehose" }, verifier, NOW).reason).toBe("bad-signature");
    expect(verifyGrant(g, { alg: "hmac-sha256", secret: "wrong" }, NOW).valid).toBe(false);
  });

  it("flags malformed grants", () => {
    expect(verifyGrant({} as any, verifier, NOW).reason).toBe("malformed");
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
