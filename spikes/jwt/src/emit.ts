import type { CheckResult } from "./check.ts";

// report.json (schemaVersion "1.0" + additive checks[]/checkTotals). Self-
// contained in the spike; schema wiring is T5.
export function buildReport(target: string, checks: CheckResult[]) {
  const checkTotals = { pass: 0, fail: 0, cant_tell: 0 };
  for (const c of checks) checkTotals[c.result]++;
  const criticalFails = checks.filter((c) => c.result === "fail").length;
  const now = new Date();

  return {
    schemaVersion: "1.0",
    run: {
      id: now.toISOString().replace(/[-:T]/g, "").slice(0, 14),
      date: now.toISOString().slice(0, 10),
      requirements: `Privy/JWT access-token verification audit of ${target}`,
      generator: "brainblast-spike-jwt",
    },
    summary: {
      building: "Privy access-token verification",
      verdict: criticalFails > 0 ? "blocked" : "ready",
      topRisk: criticalFails > 0
        ? "Access token accepted without full verification; auth bypass."
        : null,
      mustDecideFirst: null,
      watchOutFor: null,
    },
    components: [
      {
        name: "Privy auth",
        type: "Auth",
        version: "unversioned",
        sourceUrl: "https://docs.privy.io/authentication/user-authentication/access-tokens",
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
