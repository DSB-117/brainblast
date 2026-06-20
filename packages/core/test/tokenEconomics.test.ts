import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "../src/loadRules.ts";
import {
  ECONOMIC_PATTERNS,
  getEconomicPattern,
  economicPatternsByCategory,
  enforcedCount,
  renderEconomicsMd,
  renderEconomicsText,
  renderEconomicDetailText,
} from "../src/tokenEconomics.ts";

const here = dirname(fileURLToPath(import.meta.url));
const rules = loadRules(resolve(here, "..", "rules"));
const ruleIds = new Set(rules.map((r) => r.id));

describe("Token Economics catalog — integrity", () => {
  it("every enforced pattern's ruleId resolves to a real bundled rule", () => {
    for (const e of ECONOMIC_PATTERNS) {
      if (e.ruleId) {
        expect(ruleIds.has(e.ruleId), `pattern '${e.id}' references missing rule '${e.ruleId}'`).toBe(true);
      }
    }
  });

  it("status matches ruleId presence (enforced ⇔ has a rule)", () => {
    for (const e of ECONOMIC_PATTERNS) {
      if (e.status === "enforced") expect(e.ruleId).toBeTruthy();
      if (e.status === "advisory") expect(e.ruleId).toBeNull();
    }
  });

  it("ids are unique and every entry has the required prose", () => {
    const ids = ECONOMIC_PATTERNS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ECONOMIC_PATTERNS) {
      expect(e.whatZeroMeans.length).toBeGreaterThan(0);
      expect(e.fix.length).toBeGreaterThan(0);
      expect(["royalty", "fee", "reward"]).toContain(e.category);
    }
  });

  it("covers all three sub-classes named in the release (fees, royalties, rewards)", () => {
    expect(economicPatternsByCategory("royalty").length).toBeGreaterThan(0);
    expect(economicPatternsByCategory("fee").length).toBeGreaterThan(0);
    expect(economicPatternsByCategory("reward").length).toBeGreaterThan(0);
  });

  it("ties the original Bags trap into the generalized class", () => {
    const bags = getEconomicPattern("bags-fee-share-creator-included");
    expect(bags).toBeDefined();
    expect(bags!.ruleId).toBe("bags-fee-share-creator-included");
    expect(bags!.category).toBe("fee");
  });

  it("the Metaplex flagship is enforced by metaplex-seller-fee-zero", () => {
    const m = getEconomicPattern("metaplex-seller-fee");
    expect(m!.ruleId).toBe("metaplex-seller-fee-zero");
    expect(m!.status).toBe("enforced");
  });
});

describe("Token Economics catalog — lookup & renderers", () => {
  it("getEconomicPattern matches by id or ruleId", () => {
    expect(getEconomicPattern("metaplex-seller-fee")?.id).toBe("metaplex-seller-fee");
    expect(getEconomicPattern("metaplex-seller-fee-zero")?.id).toBe("metaplex-seller-fee");
    expect(getEconomicPattern("nope")).toBeUndefined();
  });

  it("enforcedCount counts only enforced entries", () => {
    expect(enforcedCount()).toBe(ECONOMIC_PATTERNS.filter((e) => e.status === "enforced").length);
    expect(enforcedCount()).toBeGreaterThanOrEqual(2);
  });

  it("markdown includes the table, every field, and the enforced/total ratio", () => {
    const md = renderEconomicsMd();
    expect(md).toContain("Token Economics");
    expect(md).toContain("| Category | SDK | Field | Status | Rule |");
    for (const e of ECONOMIC_PATTERNS) expect(md).toContain(e.field);
    expect(md).toContain("enforced by a bundled rule");
  });

  it("text summary marks enforced vs advisory", () => {
    const txt = renderEconomicsText();
    expect(txt).toContain("[enforced]");
    expect(txt).toContain("[advisory]");
  });

  it("detail view surfaces what-zero-means + fix", () => {
    const d = renderEconomicDetailText(getEconomicPattern("metaplex-seller-fee")!);
    expect(d).toContain("zero means");
    expect(d).toContain("fix:");
  });
});
