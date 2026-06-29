import { describe, it, expect } from "vitest";
import { handleRequest, type ServerDeps, type ServerLot } from "../src/server.ts";
import { generateDistributorKeypair, issueGrant, type UsageRecord } from "../src/marketplace.ts";
import type { CorpusVti } from "../src/corpus.ts";

const NOW = "2026-06-29T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z"; // well past every tier's freshness holdback

function vti(over: Partial<CorpusVti> & { trapId: string }): CorpusVti {
  return {
    sdk: { name: "@solana/web3.js" },
    severity: "high",
    class: "silent-zero-revenue",
    corroborationCount: 0,
    redGreenProof: { red: true, green: true } as any,
    vulnerable: { snippet: "VULN", lang: "typescript" } as any,
    fixed: { snippet: "FIXED", lang: "typescript" } as any,
    provenance: { sourceUrls: ["https://docs.example/x"] } as any,
    license: "synthetic-owned",
    capturedAt: OLD,
    ...over,
  };
}

const dist = generateDistributorKeypair();

function deps(over: Partial<ServerDeps> = {}): ServerDeps {
  const lotsA: ServerLot = { name: "seed.jsonl", vtis: [vti({ trapId: "a" }), vti({ trapId: "b", sdk: { name: "@meteora-ag/dlmm" } })] };
  const lotsB: ServerLot = { name: "contrib.jsonl", vtis: [vti({ trapId: "c", sdk: { name: "Pyth" } })] };
  return { lots: [lotsA, lotsB], trustedDistributor: dist.address, now: NOW, ...over };
}

function get(path: string, query: Record<string, string> = {}, grant?: any, d = deps()) {
  return handleRequest({ method: "GET", path, query, grant }, d);
}

function ndjsonLines(body: string): any[] {
  return body.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("server — public, anonymous surfaces", () => {
  it("GET /healthz reports lot + vti counts", () => {
    const r = get("/healthz");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ status: "ok", lots: 2, vtis: 3 });
  });

  it("GET /catalog is public — no grant — and lists tiers", () => {
    const r = get("/catalog");
    expect(r.status).toBe(200);
    const cat = JSON.parse(r.body);
    expect(cat.counts.proven).toBe(3);
    expect(cat.tiers.map((t: any) => t.tier)).toEqual(["sample", "standard", "firehose"]);
  });

  it("GET /feed with no grant serves the anonymous SAMPLE tier — receipt only, no fixtures", () => {
    const r = get("/feed");
    expect(r.status).toBe(200);
    const lines = ndjsonLines(r.body);
    expect(lines[0]).toMatchObject({ type: "feed_meta", tier: "sample", access: "anonymous" });
    const vtis = lines.filter((l) => l.type === "vti");
    expect(vtis.length).toBeGreaterThan(0);
    for (const v of vtis) expect(v.fixtures).toBeUndefined();
  });
});

describe("server — gated feed (entitlement enforced at distribution)", () => {
  it("a valid ed25519 grant unlocks the entitled tier + fixtures, and is metered", () => {
    const metered: UsageRecord[] = [];
    const g = issueGrant({ buyer: "acme", tier: "firehose", lots: [], signer: { alg: "ed25519", secretKey: dist.secretKey }, ttlDays: 30, now: NOW });
    const r = get("/feed", {}, g, deps({ meter: (rec) => metered.push(rec) }));
    expect(r.status).toBe(200);
    const lines = ndjsonLines(r.body);
    expect(lines[0]).toMatchObject({ type: "feed_meta", tier: "firehose", access: "granted", buyer: "acme" });
    const vtis = lines.filter((l) => l.type === "vti");
    expect(vtis.length).toBe(3); // firehose: all, no holdback
    expect(vtis[0].fixtures).toBeDefined(); // paid tier unlocks the payload
    // Metered exactly once, with the served count.
    expect(metered.length).toBe(1);
    expect(metered[0]).toMatchObject({ buyer: "acme", tier: "firehose", recordsServed: 3 });
  });

  it("rejects a forged tier (tampered body) with 403", () => {
    const g = issueGrant({ buyer: "acme", tier: "sample", lots: [], signer: { alg: "ed25519", secretKey: dist.secretKey }, ttlDays: 30, now: NOW });
    const r = get("/feed", {}, { ...g, tier: "firehose" });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).reason).toBe("bad-signature");
  });

  it("rejects a grant from an untrusted distributor with 403", () => {
    const other = generateDistributorKeypair();
    const g = issueGrant({ buyer: "evil", tier: "firehose", lots: [], signer: { alg: "ed25519", secretKey: other.secretKey }, ttlDays: 30, now: NOW });
    const r = get("/feed", {}, g);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).reason).toBe("untrusted-signer");
  });

  it("does NOT meter a rejected pull", () => {
    const metered: UsageRecord[] = [];
    const other = generateDistributorKeypair();
    const g = issueGrant({ buyer: "evil", tier: "firehose", lots: [], signer: { alg: "ed25519", secretKey: other.secretKey }, ttlDays: 30, now: NOW });
    const r = get("/feed", {}, g, deps({ meter: (rec) => metered.push(rec) }));
    expect(r.status).toBe(403);
    expect(metered.length).toBe(0);
  });

  it("enforces lot-scope: a grant naming one lot only serves that lot", () => {
    // Grant scoped to contrib.jsonl (which holds only trap "c" / Pyth).
    const g = issueGrant({ buyer: "acme", tier: "firehose", lots: ["contrib.jsonl"], signer: { alg: "ed25519", secretKey: dist.secretKey }, ttlDays: 30, now: NOW });
    const r = get("/feed", {}, g);
    const vtis = ndjsonLines(r.body).filter((l) => l.type === "vti");
    expect(vtis.map((v) => v.trapId)).toEqual(["c"]);
  });

  it("respects query filters on the gated feed", () => {
    const g = issueGrant({ buyer: "acme", tier: "firehose", lots: [], signer: { alg: "ed25519", secretKey: dist.secretKey }, ttlDays: 30, now: NOW });
    const r = get("/feed", { sdk: "meteora" }, g);
    const vtis = ndjsonLines(r.body).filter((l) => l.type === "vti");
    expect(vtis.map((v) => v.trapId)).toEqual(["b"]);
  });
});

describe("server — routing", () => {
  it("404 for unknown paths", () => {
    expect(get("/nope").status).toBe(404);
  });
  it("405 for non-GET", () => {
    expect(handleRequest({ method: "POST", path: "/feed", query: {} }, deps()).status).toBe(405);
  });
});
