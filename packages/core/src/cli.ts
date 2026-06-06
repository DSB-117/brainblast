#!/usr/bin/env -S npx tsx
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.ts";
import { rules } from "../rules/index.ts";

// Usage: brainblast <targetDir> [--ci]
// Runs every bundled rule. CANT_TELL warns and does NOT fail --ci (eng review D4).
const args = process.argv.slice(2);
const ci = args.includes("--ci");
const targetDir = args.find((a) => !a.startsWith("--")) ?? process.cwd();

const { checks, report } = audit(targetDir, rules);

const outDir = join(targetDir, ".agent-research");
mkdirSync(outDir, { recursive: true });
const reportPath = join(outDir, "report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`brainblast: scanned ${targetDir} with ${rules.length} rule(s)`);
if (checks.length === 0) console.log("  (no catastrophic components detected)");
for (const c of checks) {
  const tag = c.result === "pass" ? "PASS " : c.result === "fail" ? "FAIL " : "WARN ";
  console.log(`  [${tag}] ${c.ruleId}  ${c.file}:${c.line}`);
  console.log(`          ${c.detail}`);
}
const fails = checks.filter((c) => c.result === "fail").length;
const cantTell = checks.filter((c) => c.result === "cant_tell").length;
console.log(`  verdict: ${report.summary.verdict}  (fail=${fails}, cant_tell=${cantTell})`);
console.log(`  report:  ${reportPath}`);

if (ci) process.exit(fails > 0 ? 1 : 0);
