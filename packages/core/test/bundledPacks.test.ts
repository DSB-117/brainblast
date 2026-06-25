import { describe, it, expect } from "vitest";
import { listBundledPacks, resolveBundledPackToken } from "../src/bundledPacks.ts";
import { validatePack } from "../src/pack.ts";

const packs = listBundledPacks();

describe("Protocol Pack Library — bundled packs", () => {
  it("discovers the bundled packs (incl. the v0.7.6 protocol packs)", () => {
    const ids = packs.map((p) => p.id);
    expect(ids).toContain("jupiter-quote-zero-slippage");
    expect(ids).toContain("raydium-compute-zero-slippage");
    expect(ids).toContain("pyth-price-unchecked-staleness");
    expect(ids).toContain("meteora-dlmm-zero-min-out");
    expect(ids).toContain("jito-bundle-zero-tip");
  });

  it("every bundled pack proves RED → GREEN (or has no fixtures)", () => {
    expect(packs.length).toBeGreaterThan(0);
    for (const p of packs) {
      const result = validatePack(p.dir);
      // Each rule must either prove RED→GREEN, be explicitly fixture-less, or be
      // unverifiable here (e.g. a compiler-proven pack whose pinned SDK isn't
      // installed in this environment) — all non-fatal.
      for (const r of result.ruleResults) {
        expect(
          r.status === "ok" || r.status === "missing-fixtures" || r.status === "unverifiable",
          `pack ${p.id} rule ${r.ruleId}: ${r.status} — ${r.detail}`,
        ).toBe(true);
      }
      expect(result.ok, `pack ${p.id} failed validation`).toBe(true);
    }
  });

  it("the v0.7.6 protocol packs each prove RED→GREEN (have fixtures)", () => {
    for (const id of ["pyth-price-unchecked-staleness", "meteora-dlmm-zero-min-out", "jito-bundle-zero-tip"]) {
      const pack = packs.find((p) => p.id === id)!;
      const result = validatePack(pack.dir);
      expect(result.ruleResults.every((r) => r.status === "ok")).toBe(true);
    }
  });
});

describe("Protocol Pack Library — name resolution", () => {
  it("resolves a protocol name to its pack dir (unambiguous leading segment)", () => {
    expect(resolveBundledPackToken("pyth")).toContain("pyth-price-unchecked-staleness");
    expect(resolveBundledPackToken("meteora")).toContain("meteora-dlmm-zero-min-out");
    expect(resolveBundledPackToken("jito")).toContain("jito-bundle-zero-tip");
    expect(resolveBundledPackToken("jupiter")).toContain("jupiter-quote-zero-slippage");
    expect(resolveBundledPackToken("raydium")).toContain("raydium-compute-zero-slippage");
  });

  it("resolves an exact pack id", () => {
    expect(resolveBundledPackToken("pyth-price-unchecked-staleness")).toContain("pyth-price-unchecked-staleness");
  });

  it("returns null for an unknown token", () => {
    expect(resolveBundledPackToken("not-a-real-protocol")).toBeNull();
  });
});
