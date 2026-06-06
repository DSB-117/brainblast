import type { CheckResult } from "./check.ts";

// Builds report.json. Superset of the committed schema (schemaVersion "1.0")
// with the additive `checks[]` + `checkTotals` proposed in the eng review (T5).
// Kept self-contained in the spike; wiring into schema/report.schema.json is T5.
export function buildReport(target: string, checks: CheckResult[]) {
  const checkTotals = { pass: 0, fail: 0, cant_tell: 0 };
  for (const c of checks) checkTotals[c.result]++;
  const criticalFails = checks.filter((c) => c.result === "fail").length;
  const now = new Date();

  return {
    schemaVersion: "1.0",
    run: {
      id: now.toISOString().replace(/[-:T]/g, "").slice(0, 15),
      date: now.toISOString().slice(0, 10),
      requirements: `Stripe webhook signature audit of ${target}`,
      generator: "brainblast-spike-stripe",
    },
    summary: {
      building: "Stripe webhook handler",
      verdict: criticalFails > 0 ? "blocked" : "ready",
      topRisk: criticalFails > 0
        ? "Webhook signature not verified on the raw body; forged events are accepted."
        : null,
      mustDecideFirst: null,
      watchOutFor: null,
    },
    components: [
      {
        name: "Stripe webhook",
        type: "API",
        version: "unversioned",
        sourceUrl: "https://docs.stripe.com/webhooks/signature",
        status: "fresh",
        risks: checks
          .filter((c) => c.result === "fail")
          .map((c) => ({ severity: "critical", title: c.title, detail: c.detail })),
      },
    ],
    riskTotals: { critical: criticalFails, high: 0, medium: 0, low: 0 },
    checks: checks.map((c) => ({
      ruleId: c.ruleId,
      severity: c.severity,
      result: c.result,
      file: c.file,
      line: c.line,
      title: c.title,
      detail: c.detail,
    })),
    checkTotals,
    openQuestions: [],
  };
}
