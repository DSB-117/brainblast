import { describe, it, expect } from "vitest";
import { scoreVti, dedupKey, buildCorpusIndex, type CorpusVti } from "../src/corpus.ts";

function vti(p: Partial<CorpusVti>): CorpusVti {
  return {
    trapId: "t",
    sdk: { name: "sdk-a" },
    severity: "high",
    class: "missing-verification",
    corroborationCount: 0,
    redGreenProof: { red: true, green: true },
    vulnerable: { snippet: "const a = 1;" },
    license: "synthetic-owned",
    ...p,
  };
}

describe("scoreVti", () => {
  it("is 0 for an unproven record", () => {
    expect(scoreVti(vti({ redGreenProof: { red: true, green: false } }))).toBe(0);
  });
  it("increases with severity", () => {
    const low = scoreVti(vti({ severity: "low" }));
    const crit = scoreVti(vti({ severity: "critical" }));
    expect(crit).toBeGreaterThan(low);
  });
  it("increases with corroboration and saturates at 5", () => {
    const c0 = scoreVti(vti({ corroborationCount: 0 }));
    const c5 = scoreVti(vti({ corroborationCount: 5 }));
    const c50 = scoreVti(vti({ corroborationCount: 50 }));
    expect(c5).toBeGreaterThan(c0);
    expect(c50).toBe(c5); // saturated
  });
  it("a critical, well-corroborated trap scores 100", () => {
    expect(scoreVti(vti({ severity: "critical", corroborationCount: 5 }))).toBe(100);
  });
});

describe("dedupKey", () => {
  it("ignores indentation / trailing whitespace but not real token differences", () => {
    const a = dedupKey(vti({ vulnerable: { snippet: "const a = 1;" } }));
    const b = dedupKey(vti({ vulnerable: { snippet: "  const a = 1;\n" } }));
    expect(a).toBe(b); // only whitespace differs → same record
    const c = dedupKey(vti({ vulnerable: { snippet: "const a = 2;" } }));
    expect(a).not.toBe(c); // different code → different record
  });
  it("differs across SDKs", () => {
    expect(dedupKey(vti({ sdk: { name: "a" } }))).not.toBe(dedupKey(vti({ sdk: { name: "b" } })));
  });
});

describe("buildCorpusIndex", () => {
  it("counts duplicates and keeps unique coverage", () => {
    const dup = vti({ trapId: "dup", sdk: { name: "sdk-a" }, vulnerable: { snippet: "x" } });
    const idx = buildCorpusIndex([dup, { ...dup }, vti({ trapId: "other", sdk: { name: "sdk-b" }, class: "unchecked-staleness" })]);
    expect(idx.counts.vtis).toBe(3);
    expect(idx.counts.unique).toBe(2);
    expect(idx.counts.duplicates).toBe(1);
    expect(idx.counts.sdks).toBe(2);
    expect(idx.scored.filter((s) => s.duplicateOf).length).toBe(1);
  });

  it("builds a class×sdk coverage matrix and flags thin cells", () => {
    const idx = buildCorpusIndex([
      vti({ trapId: "a", class: "auth-bypass", sdk: { name: "sdk-a" } }),
    ]);
    expect(idx.coverage.matrix["auth-bypass"]["sdk-a"]).toBe(1);
    expect(idx.coverage.thinCells).toContainEqual({ class: "auth-bypass", sdk: "sdk-a" });
    expect(idx.coverage.missingClasses).toContain("silent-zero-revenue");
  });
});
