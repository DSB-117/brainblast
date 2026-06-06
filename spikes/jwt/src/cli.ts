#!/usr/bin/env -S npx tsx
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.ts";

// Usage: brainblast-spike-jwt <targetDir> [--ci]
// CANT_TELL warns and does NOT fail --ci (eng review D4).
const args = process.argv.slice(2);
const ci = args.includes("--ci");
const targetDir = args.find((a) => !a.startsWith("--")) ?? process.cwd();

const { checks, report } = audit(targetDir);

const outDir = join(targetDir, ".agent-research");
mkdirSync(outDir, { recursive: true });
const reportPath = join(outDir, "spike-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`brainblast-spike-jwt: scanned ${targetDir}`);
if (checks.length === 0) console.log("  (no token verifier detected)");
for (const c of checks) {
  const tag = c.result === "pass" ? "PASS " : c.result === "fail" ? "FAIL " : "WARN ";
  console.log(`  [${tag}] ${c.file}:${c.line}`);
  console.log(`          ${c.detail}`);
}
const fails = checks.filter((c) => c.result === "fail").length;
const cantTell = checks.filter((c) => c.result === "cant_tell").length;
console.log(`  verdict: ${report.summary.verdict}  (fail=${fails}, cant_tell=${cantTell})`);
console.log(`  report:  ${reportPath}`);

if (ci) process.exit(fails > 0 ? 1 : 0);
