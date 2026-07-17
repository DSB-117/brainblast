import { describe, it, expect } from "vitest";
import {
  computeClassBudget,
  gateClass,
  countsFromDistribution,
  MAX_SHARE,
  MIN_SHARE,
  type ClassCounts,
} from "../src/classBudget.ts";

// The corpus's real skew (datasets/catalog.json snapshot): auth-bypass and
// missing-verification dominate; the high-value classes are starved.
const SKEWED: ClassCounts = {
  "missing-verification": 27,
  "auth-bypass": 35,
  other: 8,
  "silent-zero-revenue": 4,
  "unconfirmed-state": 8,
  "missing-slippage-guard": 4,
  "immutable-after-deploy": 1,
  "unchecked-staleness": 1,
  "wrong-constant": 2,
};

describe("computeClassBudget", () => {
  const b = computeClassBudget(SKEWED);
  const row = (c: string) => b.rows.find((r) => r.class === c)!;

  it("counts the whole corpus", () => {
    expect(b.total).toBe(90);
  });

  it("flags the two dominant classes as surplus (≥ 25%)", () => {
    expect(row("auth-bypass").status).toBe("surplus"); // 38.9%
    expect(row("missing-verification").status).toBe("surplus"); // 30%
    expect(row("auth-bypass").roomToMax).toBe(0);
  });

  it("flags the starved high-value classes as deficit (< 5%)", () => {
    for (const c of ["immutable-after-deploy", "unchecked-staleness", "wrong-constant", "silent-zero-revenue", "missing-slippage-guard"]) {
      expect(row(c).status, c).toBe("deficit");
      expect(row(c).needToMin, c).toBeGreaterThan(0);
    }
  });

  it("work order is scarcest-first and excludes surplus + 'other'", () => {
    expect(b.workOrder).not.toContain("auth-bypass");
    expect(b.workOrder).not.toContain("missing-verification");
    expect(b.workOrder).not.toContain("other");
    // the two 1-count classes lead
    expect(b.workOrder.slice(0, 2).sort()).toEqual(["immutable-after-deploy", "unchecked-staleness"].sort());
  });

  it("needToMin actually clears MIN_SHARE once added", () => {
    const r = row("unchecked-staleness");
    const newShare = (r.count + r.needToMin) / (b.total + r.needToMin);
    expect(newShare).toBeGreaterThanOrEqual(MIN_SHARE);
  });
});

describe("gateClass", () => {
  it("defers a surplus class and suggests scarce ones", () => {
    const v = gateClass("auth-bypass", SKEWED);
    expect(v.allow).toBe(false);
    expect(v.status).toBe("surplus");
    expect(v.suggest.length).toBeGreaterThan(0);
    expect(v.suggest).not.toContain("auth-bypass");
  });

  it("allows a scarce class", () => {
    const v = gateClass("wrong-constant", SKEWED);
    expect(v.allow).toBe(true);
    expect(v.status).toBe("deficit");
  });

  it("bootstraps: empty corpus allows anything", () => {
    expect(gateClass("auth-bypass", {}).allow).toBe(true);
  });

  it("an unknown class label folds to 'other'", () => {
    const v = gateClass("not-a-real-class", SKEWED);
    expect(v.class).toBe("other");
  });
});

describe("countsFromDistribution", () => {
  it("reads a catalog.json / corpus-index.json shape", () => {
    const counts = countsFromDistribution({ classDistribution: { "auth-bypass": 35, "wrong-constant": 2 } });
    expect(counts["auth-bypass"]).toBe(35);
    expect(gateClass("auth-bypass", counts).allow).toBe(false);
  });

  it("tolerates missing/garbage input", () => {
    expect(countsFromDistribution(null)).toEqual({});
    expect(countsFromDistribution({})).toEqual({});
  });
});
