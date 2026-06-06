import { findCandidates } from "./finder.ts";
import { runChecker } from "./checkers/index.ts";
import { buildReport } from "./emit.ts";
import type { CheckResult, Rule } from "./types.ts";

// detect -> check, for a single rule.
export function auditWithRule(targetDir: string, rule: Rule): CheckResult[] {
  return findCandidates(targetDir, rule).map((c) => {
    const outcome = runChecker(rule.check.kind, c, rule.check.params);
    return {
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.title,
      file: c.filePath,
      line: c.fn.getStartLineNumber(),
      exportName: c.fnName,
      ...outcome,
    };
  });
}

// Run every rule against a target, build the report.
export function audit(targetDir: string, rules: Rule[]) {
  const checks = rules.flatMap((r) => auditWithRule(targetDir, r));
  const report = buildReport(targetDir, checks, rules);
  return { checks, report };
}
