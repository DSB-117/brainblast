import { findCandidates } from "./finder.ts";
import { findRustCandidates } from "./rustFinder.ts";
import { findConfigCandidates } from "./configFinder.ts";
import { runChecker } from "./checkers/index.ts";
import { runFixer } from "./fixers/index.ts";
import { buildReport } from "./emit.ts";
import { rangeChanged, fileChanged, type ChangedRanges } from "./gitDiff.ts";
import type { CheckResult, Rule } from "./types.ts";

// detect -> check, for a single rule. When `changedRanges` is provided
// (diff-aware / `--since` mode), only candidates that overlap a changed line
// range are checked — function-scoped candidates (TS/Rust) by their line
// span, config candidates by whether the whole file changed at all.
export function auditWithRule(targetDir: string, rule: Rule, changedRanges?: ChangedRanges): CheckResult[] {
  if (rule.detect.lang === "config") {
    return findConfigCandidates(targetDir, rule)
      .filter((c) => !changedRanges || fileChanged(changedRanges, c.filePath))
      .map((c) => {
        const outcome = runChecker(rule.check.kind, c, rule.check.params);
        return {
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          file: c.filePath,
          line: 1,
          exportName: c.filePath,
          ...outcome,
        };
      });
  }

  if (rule.detect.lang === "rust") {
    return findRustCandidates(targetDir, rule)
      .filter((c) => {
        if (!changedRanges) return true;
        const start = (c.fnBodyNode?.startPosition?.row ?? 0) + 1;
        const end = (c.fnBodyNode?.endPosition?.row ?? start - 1) + 1;
        return rangeChanged(changedRanges, c.filePath, start, end);
      })
      .map((c) => {
        const outcome = runChecker(rule.check.kind, c, rule.check.params);
        return {
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          file: c.filePath,
          line: 1, // tree-sitter line numbers available via fnBodyNode.startPosition.row + 1
          exportName: c.fnName,
          ...outcome,
        };
      });
  }

  return findCandidates(targetDir, rule)
    .filter((c) => {
      if (!changedRanges) return true;
      return rangeChanged(changedRanges, c.filePath, c.fn.getStartLineNumber(), c.fn.getEndLineNumber());
    })
    .map((c) => {
      const outcome = runChecker(rule.check.kind, c, rule.check.params);
      const fix = runFixer(rule.check.kind, c, rule.check.params, outcome);
      return {
        ruleId: rule.id,
        severity: rule.severity,
        title: rule.title,
        file: c.filePath,
        line: c.fn.getStartLineNumber(),
        exportName: c.fnName,
        ...outcome,
        ...(fix ? { fix } : {}),
      };
    });
}

// Run every rule against a target, build the report. Pass `changedRanges`
// (from gitDiff.getChangedRanges) for diff-aware / `--since` scans.
export function audit(targetDir: string, rules: Rule[], changedRanges?: ChangedRanges) {
  const checks = rules.flatMap((r) => auditWithRule(targetDir, r, changedRanges));
  const report = buildReport(targetDir, checks, rules);
  return { checks, report };
}
