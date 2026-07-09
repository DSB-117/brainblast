// HiveMind write-time enforcement — correction inside the agent's write loop.
//
// The briefing teaches BEFORE code is written; the audit gates AFTER. This is
// the middle leg: the moment an agent writes or edits a file, check just that
// file against the full live rule set (bundled + project + hive mirror) and
// feed any hit straight back into the agent's context — "the line you just
// wrote is a proven trap; here is the fixed form" — while the agent is still
// holding the file in its head.
//
// Single-file checking rides the auditor's existing ChangedRanges mechanism:
// the whole file is one changed range, so only candidates in this file are
// ever checked. Same engine, same rules, zero parallel logic.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { audit } from "../audit.ts";
import { resolveRules } from "../resolveRules.ts";
import { hiveRoot } from "./store.ts";
import { crossRepoPrecedent, loadExperience } from "./experience.ts";
import type { ChangedRanges } from "../gitDiff.ts";
import type { CheckResult } from "../types.ts";

// File types the engine can currently parse. Anything else exits silently —
// a hook must never slow down or noise up edits it can't judge.
const CHECKABLE = /\.(ts|tsx|js|jsx|mjs|cjs|rs|go|sol|py|env[^/]*)$/i;

export function isCheckableFile(filePath: string): boolean {
  return CHECKABLE.test(filePath) || /(^|\/)\.env[^/]*$/.test(filePath);
}

export interface WriteCheckResult {
  file: string;
  checked: boolean; // false when the file type isn't checkable / file missing
  failures: CheckResult[];
  rulesLoaded: number;
}

export function checkWrittenFile(filePath: string, repoDir: string): WriteCheckResult {
  const abs = resolve(filePath);
  if (!isCheckableFile(abs) || !existsSync(abs)) {
    return { file: abs, checked: false, failures: [], rulesLoaded: 0 };
  }
  const lineCount = readFileSync(abs, "utf8").split("\n").length;
  const ranges: ChangedRanges = new Map([[abs, [[1, Math.max(1, lineCount)]]]]);
  const rules = resolveRules(repoDir);
  const { checks } = audit(repoDir, rules, ranges);
  const failures = checks.filter((c) => c.result === "fail");

  // Cross-repo experience: if an agent on this machine already fixed one of
  // these traps in another repo, say so — the fastest path to the right fix.
  try {
    const experience = loadExperience(hiveRoot());
    for (const f of failures) {
      if (!f.precedent) {
        const p = crossRepoPrecedent(experience, f.ruleId, resolve(repoDir));
        if (p) f.precedent = p;
      }
    }
  } catch {
    // experience is advisory — never fail the check over it
  }

  return {
    file: abs,
    checked: true,
    failures,
    rulesLoaded: rules.length,
  };
}

// The feedback the agent sees, budgeted: enough to fix, not a wall.
export function renderWriteFeedback(result: WriteCheckResult, maxFindings = 5): string {
  const shown = result.failures.slice(0, maxFindings);
  const lines: string[] = [];
  lines.push(
    `[HiveMind] The file you just wrote matches ${result.failures.length} RED→GREEN-proven trap${result.failures.length === 1 ? "" : "s"}:`,
  );
  for (const f of shown) {
    lines.push(`- [${(f.severity ?? "").toUpperCase()}] ${f.ruleId}: ${f.detail}${f.line ? ` (${f.file}:${f.line})` : ` (${f.file})`}`);
    if (f.fix?.summary) lines.push(`  fix: ${f.fix.summary}`);
    if (f.fix?.suggestion) lines.push(`       ${f.fix.suggestion}`);
    if (f.precedent) lines.push(`  precedent: this exact trap was already fixed in ${f.precedent.file} on ${f.precedent.fixedAt}`);
  }
  if (result.failures.length > shown.length) {
    lines.push(`…and ${result.failures.length - shown.length} more — run \`npx brainblast .\` for the full report.`);
  }
  lines.push("These are verified traps (each reproduces RED→GREEN), not lint opinions. Fix them before moving on.");
  return lines.join("\n");
}
