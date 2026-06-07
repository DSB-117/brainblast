import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport } from "../src/emit.ts";
import { findCandidates } from "../src/finder.ts";
import { rules } from "../rules/index.ts";
import type { CheckResult } from "../src/types.ts";

const stripeWebhookRawBody = rules.find((r) => r.id === "stripe-webhook-raw-body-verification")!;

const STRIPE_SRC = `import Stripe from "stripe"; const s = new Stripe("x");
export function handleStripeWebhook(rawBody: string, sig: string) { return s.webhooks.constructEvent(rawBody, sig, "sec"); }`;

describe("emit fallbacks", () => {
  it("uses fallback component metadata when a check references an unknown ruleId", () => {
    const ghost: CheckResult = {
      ruleId: "ghost-rule",
      severity: "critical",
      title: "t",
      file: "f.ts",
      line: 1,
      exportName: "h",
      result: "fail",
      detail: "d",
    };
    const r = buildReport("x", [ghost], []); // empty rule set -> no metadata
    expect(r.components[0].name).toBe("ghost-rule");
    expect(r.components[0].type).toBe("Other");
    expect(r.components[0].sourceUrl).toBeNull();
    expect(r.riskTotals.critical).toBe(1);
  });
});

describe("walk / finder traversal", () => {
  it("recurses into subdirectories", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-nest-"));
    mkdirSync(join(d, "api", "stripe"), { recursive: true });
    writeFileSync(join(d, "api", "stripe", "webhook.ts"), STRIPE_SRC);
    const cs = findCandidates(d, stripeWebhookRawBody);
    expect(cs.length).toBe(1);
    expect(cs[0].fnName).toBe("handleStripeWebhook");
  });

  it("skips node_modules", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-nm-"));
    mkdirSync(join(d, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(d, "node_modules", "pkg", "webhook.ts"), STRIPE_SRC);
    expect(findCandidates(d, stripeWebhookRawBody).length).toBe(0);
  });
});
