import type { CheckResult, Rule } from "./types.ts";

// report.json: schemaVersion "1.0" + additive checks[]/checkTotals (eng review D4/T5).
export function buildReport(target: string, checks: CheckResult[], rules: Rule[]) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const checkTotals = { pass: 0, fail: 0, cant_tell: 0 };
  for (const c of checks) checkTotals[c.result]++;

  const riskTotals = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const c of checks) if (c.result === "fail") riskTotals[c.severity]++;

  // one component per rule that produced at least one result
  const ruleIdsSeen = [...new Set(checks.map((c) => c.ruleId))];
  const components = ruleIdsSeen.map((id) => {
    const rule = byId.get(id);
    const fails = checks.filter((c) => c.ruleId === id && c.result === "fail");
    return {
      name: rule?.component.name ?? id,
      type: rule?.component.type ?? "Other",
      version: rule?.component.version ?? "unversioned",
      sourceUrl: rule?.component.sourceUrl ?? null,
      status: "fresh",
      risks: fails.map((c) => ({ severity: c.severity, title: c.title, detail: c.detail })),
    };
  });

  const now = new Date();
  const totalFails = checkTotals.fail;
  return {
    schemaVersion: "1.0",
    run: {
      id: now.toISOString().replace(/[-:T]/g, "").slice(0, 14),
      date: now.toISOString().slice(0, 10),
      requirements: `Catastrophic-integration audit of ${target}`,
      generator: "@brainblast/core",
    },
    summary: {
      building: "external integrations",
      verdict: totalFails > 0 ? "blocked" : "ready",
      topRisk: totalFails > 0 ? checks.find((c) => c.result === "fail")?.detail ?? null : null,
      mustDecideFirst: null,
      watchOutFor: null,
    },
    components,
    riskTotals,
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
