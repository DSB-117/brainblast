import { describe, it, expect } from "vitest";
import { updateMemory, precedentKey, type Memory } from "../src/memory.ts";
import type { CheckResult } from "../src/types.ts";

function check(over: Partial<CheckResult>): CheckResult {
  return {
    ruleId: "stripe-webhook-raw-body-verification",
    severity: "critical",
    title: "Stripe webhook signature verified on the raw body",
    file: "/repo/routes/checkout.ts",
    line: 5,
    exportName: "handleCheckoutWebhook",
    result: "fail",
    detail: "constructEvent is called on a parsed value",
    ...over,
  };
}

const EMPTY_MEMORY: Memory = { schemaVersion: "1.0", lastRun: [], fixHistory: [] };

describe("updateMemory", () => {
  it("records a fix event when a check moves from fail to pass", () => {
    const before = [check({ result: "fail" })];
    const { memory: m1 } = updateMemory(EMPTY_MEMORY, before, new Date("2026-05-28"));
    expect(m1.fixHistory).toHaveLength(0); // first run: nothing to compare against

    const after = [check({ result: "pass", detail: "verified rawBody" })];
    const { memory: m2 } = updateMemory(m1, after, new Date("2026-05-28"));
    expect(m2.fixHistory).toEqual([
      {
        ruleId: "stripe-webhook-raw-body-verification",
        file: "/repo/routes/checkout.ts",
        exportName: "handleCheckoutWebhook",
        fixedAt: "2026-05-28",
        detail: "constructEvent is called on a parsed value",
      },
    ]);
  });

  it("surfaces a precedent for a current fail with the same rule fixed elsewhere", () => {
    // Seed memory with a fix in checkout.ts.
    const seedBefore = [check({ result: "fail" })];
    const { memory: seeded } = updateMemory(EMPTY_MEMORY, seedBefore, new Date("2026-05-28"));
    const seedAfter = [check({ result: "pass", detail: "verified rawBody" })];
    const { memory: withFix } = updateMemory(seeded, seedAfter, new Date("2026-05-28"));

    // New run: a different file (refund.ts) now fails the same rule.
    const newFail = check({
      file: "/repo/routes/refund.ts",
      exportName: "handleRefundWebhook",
      result: "fail",
      detail: "constructEvent is called on a parsed value",
    });
    const { precedents } = updateMemory(withFix, [newFail], new Date("2026-06-11"));

    const p = precedents.get(precedentKey(newFail));
    expect(p).toEqual({
      file: "/repo/routes/checkout.ts",
      exportName: "handleCheckoutWebhook",
      fixedAt: "2026-05-28",
      detail: "constructEvent is called on a parsed value",
    });
  });

  it("does not surface a precedent for a fail in the same file as the fix", () => {
    const seedBefore = [check({ result: "fail" })];
    const { memory: seeded } = updateMemory(EMPTY_MEMORY, seedBefore, new Date("2026-05-28"));
    const seedAfter = [check({ result: "pass", detail: "verified rawBody" })];
    const { memory: withFix } = updateMemory(seeded, seedAfter, new Date("2026-05-28"));

    // Same file regresses again.
    const regressed = check({ result: "fail" });
    const { precedents } = updateMemory(withFix, [regressed], new Date("2026-06-11"));

    expect(precedents.get(precedentKey(regressed))).toBeUndefined();
  });

  it("does not surface a precedent when no prior fix exists for the rule", () => {
    const newFail = check({ result: "fail" });
    const { precedents } = updateMemory(EMPTY_MEMORY, [newFail], new Date("2026-06-11"));
    expect(precedents.size).toBe(0);
  });
});
