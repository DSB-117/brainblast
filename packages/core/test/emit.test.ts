import { describe, it, expect } from "vitest";
import { buildReport } from "../src/emit.ts";
import { rules } from "../rules/index.ts";
import type { CheckResult, CheckResultKind, Severity } from "../src/types.ts";

const mk = (ruleId: string, result: CheckResultKind, severity: Severity = "critical"): CheckResult => ({
  ruleId,
  severity,
  title: "t",
  file: "f.ts",
  line: 1,
  exportName: "h",
  result,
  detail: "d",
});

describe("buildReport", () => {
  it("computes checkTotals + riskTotals; verdict blocked on a fail; risks land on the failing component", () => {
    const r = buildReport(
      "x",
      [mk("stripe-webhook-raw-body-verification", "fail"), mk("privy-jwt-verification", "pass")],
      rules,
    );
    expect(r.schemaVersion).toBe("1.0");
    expect(r.checkTotals).toEqual({ pass: 1, fail: 1, cant_tell: 0 });
    expect(r.riskTotals.critical).toBe(1);
    expect(r.summary.verdict).toBe("blocked");
    expect(r.components.map((c) => c.name).sort()).toEqual(["Privy auth", "Stripe webhook"]);

    const stripe = r.components.find((c) => c.name === "Stripe webhook")!;
    const privy = r.components.find((c) => c.name === "Privy auth")!;
    expect(stripe.risks.length).toBe(1);
    expect(privy.risks.length).toBe(0);
  });

  it("verdict ready and zero risk when all checks pass", () => {
    const r = buildReport("x", [mk("stripe-webhook-raw-body-verification", "pass")], rules);
    expect(r.summary.verdict).toBe("ready");
    expect(r.riskTotals).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });

  it("riskTotals equals summed component risks (internal consistency)", () => {
    const r = buildReport(
      "x",
      [mk("stripe-webhook-raw-body-verification", "fail"), mk("privy-jwt-verification", "fail")],
      rules,
    );
    const summed = r.components.reduce((n, c) => n + c.risks.length, 0);
    const totals = r.riskTotals.critical + r.riskTotals.high + r.riskTotals.medium + r.riskTotals.low;
    expect(totals).toBe(summed);
  });
});
