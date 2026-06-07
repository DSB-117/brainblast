import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTest } from "../src/testTemplates/index.ts";
import { generateTestForResult } from "../src/generate.ts";
import { rules } from "../rules/index.ts";
import type { CheckResult } from "../src/types.ts";

const stripeWebhookRawBody = rules.find((r) => r.id === "stripe-webhook-raw-body-verification")!;

describe("test templates", () => {
  it("renders the Stripe contract referencing the handler import + export", () => {
    const src = renderTest("stripe-webhook-signature", {
      handlerImportPath: "/x/webhook.ts",
      handlerExport: "handleStripeWebhook",
    });
    expect(src).toContain("describe(");
    expect(src).toContain("handleStripeWebhook");
    expect(src).toContain("/x/webhook.ts");
    expect(src).toContain("REJECTS an invalid signature");
  });

  it("renders the Privy contract with the aud/iss rejection cases", () => {
    const src = renderTest("privy-jwt-claims", {
      handlerImportPath: "/x/auth.ts",
      handlerExport: "verifyPrivyToken",
    });
    expect(src).toContain("verifyPrivyToken");
    expect(src).toContain("REJECTS a wrong audience");
    expect(src).toContain("REJECTS a wrong issuer");
  });

  it("throws on an unknown template kind", () => {
    expect(() => renderTest("nope", { handlerImportPath: "x", handlerExport: "h" })).toThrow();
  });

  it("generateTestForResult writes a test file with the handler wired in", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-gen-"));
    const result: CheckResult = {
      ruleId: stripeWebhookRawBody.id,
      severity: "critical",
      title: "t",
      file: "/x/webhook.ts",
      line: 1,
      exportName: "handleStripeWebhook",
      result: "fail",
      detail: "d",
    };
    const out = join(d, "gen.contract.test.ts");
    generateTestForResult(result, stripeWebhookRawBody, out);
    expect(readFileSync(out, "utf8")).toContain("handleStripeWebhook");
  });
});
