import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "../src/loadRules.ts";
import {
  FEE_CONFIGS,
  getFeeConfig,
  feeConfigsByCategory,
  enforcedCount,
  renderFeeConfigsMd,
  renderFeeConfigsText,
  renderFeeConfigDetailText,
} from "../src/feeConfigs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const rules = loadRules(resolve(here, "..", "rules"));
const ruleIds = new Set(rules.map((r) => r.id));

describe("Fee Configs catalog — integrity", () => {
  it("every enforced pattern's ruleId resolves to a real bundled rule", () => {
    for (const e of FEE_CONFIGS) {
      if (e.ruleId) {
        expect(ruleIds.has(e.ruleId), `pattern '${e.id}' references missing rule '${e.ruleId}'`).toBe(true);
      }
    }
  });

  it("status matches ruleId presence (enforced ⇔ has a rule)", () => {
    for (const e of FEE_CONFIGS) {
      if (e.status === "enforced") expect(e.ruleId).toBeTruthy();
      if (e.status === "advisory") expect(e.ruleId).toBeNull();
    }
  });

  it("ids are unique and every entry has the required prose", () => {
    const ids = FEE_CONFIGS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of FEE_CONFIGS) {
      expect(e.whatZeroMeans.length).toBeGreaterThan(0);
      expect(e.fix.length).toBeGreaterThan(0);
      expect(["royalty", "fee", "reward"]).toContain(e.category);
    }
  });

  it("covers all three sub-classes named in the release (fees, royalties, rewards)", () => {
    expect(feeConfigsByCategory("royalty").length).toBeGreaterThan(0);
    expect(feeConfigsByCategory("fee").length).toBeGreaterThan(0);
    expect(feeConfigsByCategory("reward").length).toBeGreaterThan(0);
  });

  it("ties the original Bags trap into the generalized class", () => {
    const bags = getFeeConfig("bags-fee-share-creator-included");
    expect(bags).toBeDefined();
    expect(bags!.ruleId).toBe("bags-fee-share-creator-included");
    expect(bags!.category).toBe("fee");
  });

  it("the Metaplex flagship is enforced by metaplex-seller-fee-zero", () => {
    const m = getFeeConfig("metaplex-seller-fee");
    expect(m!.ruleId).toBe("metaplex-seller-fee-zero");
    expect(m!.status).toBe("enforced");
  });
});

describe("Fee Configs catalog — lookup & renderers", () => {
  it("getFeeConfig matches by id or ruleId", () => {
    expect(getFeeConfig("metaplex-seller-fee")?.id).toBe("metaplex-seller-fee");
    expect(getFeeConfig("metaplex-seller-fee-zero")?.id).toBe("metaplex-seller-fee");
    expect(getFeeConfig("nope")).toBeUndefined();
  });

  it("enforcedCount counts only enforced entries", () => {
    expect(enforcedCount()).toBe(FEE_CONFIGS.filter((e) => e.status === "enforced").length);
    expect(enforcedCount()).toBeGreaterThanOrEqual(2);
  });

  it("markdown includes the table, every field, and the enforced/total ratio", () => {
    const md = renderFeeConfigsMd();
    expect(md).toContain("Fee Configs");
    expect(md).toContain("| Category | SDK | Field | Status | Rule |");
    for (const e of FEE_CONFIGS) expect(md).toContain(e.field);
    expect(md).toContain("enforced by a bundled rule");
  });

  it("text summary marks enforced vs advisory", () => {
    const txt = renderFeeConfigsText();
    expect(txt).toContain("[enforced]");
    expect(txt).toContain("[advisory]");
  });

  it("detail view surfaces what-zero-means + fix", () => {
    const d = renderFeeConfigDetailText(getFeeConfig("metaplex-seller-fee")!);
    expect(d).toContain("zero means");
    expect(d).toContain("fix:");
  });
});
