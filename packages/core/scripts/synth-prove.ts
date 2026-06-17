import { readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../src/audit.ts";
import { loadRules } from "../src/loadRules.ts";
import { checkerKinds } from "../src/checkers/index.ts";
import { testKinds } from "../src/testTemplates/index.ts";
import { stageFinding, writeDraft } from "../src/synth/index.ts";
import type { Finding } from "../src/synth/index.ts";

// PROOF-AS-CLASSIFIER ORCHESTRATOR.
//
// One job: take a research Finding and route it. The router has no taste, no
// LLM, no opinion. It runs the existing engine on the staged rule + fixtures,
// and the audit's own RED->GREEN result is the gate.
//
//   exit 0  PROVEN — staged rule fails on vulnerable + passes on fixed. Safe
//           to promote to packages/core/rules + fixtures, no new logic ran.
//   exit 2  DRAFT  — binding.check.kind or test.kind not vetted yet, OR rule
//           loaded but the audit didn't produce the expected colors. Written
//           to packages/core/drafts/<id>/ for human review. NEVER promoted.
//   exit 1  failure — bad inputs, unexpected crash, etc.
//
// Usage: tsx scripts/synth-prove.ts <path-to-finding.json>

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const stageRoot = join(root, ".synth");
const draftsRoot = join(root, "drafts");

const findingPath = process.argv[2];
if (!findingPath) {
  console.error("usage: synth-prove <path-to-finding.json>");
  process.exit(1);
}
const absFinding = resolve(findingPath);
if (!existsSync(absFinding)) {
  console.error(`finding not found: ${absFinding}`);
  process.exit(1);
}

let f: Finding;
try {
  f = JSON.parse(readFileSync(absFinding, "utf8")) as Finding;
} catch (e: any) {
  console.error(`failed to parse finding JSON: ${e?.message ?? e}`);
  process.exit(1);
}

console.log(`\n==== synth-prove: ${f.id} ====`);
console.log(`  binding: check.kind='${f.binding.check.kind}', test.kind='${f.binding.test.kind}'`);

// Gate 1: vetted-kind check (the cheapest, most important guardrail). We do
// this BEFORE staging anything so a clearly-unfit finding goes straight to
// drafts/ without polluting .synth/.
const unknownCheck = !checkerKinds.includes(f.binding.check.kind);
const unknownTest = !testKinds.includes(f.binding.test.kind);
if (unknownCheck || unknownTest) {
  const reason = [
    unknownCheck ? `check.kind '${f.binding.check.kind}' is not in the vetted registry [${checkerKinds.join(", ")}]` : null,
    unknownTest ? `test.kind '${f.binding.test.kind}' is not in the vetted registry [${testKinds.join(", ")}]` : null,
  ].filter(Boolean).join("; ");
  const dir = writeDraft(draftsRoot, f, reason);
  console.log(`  -> DRAFT: ${reason}`);
  console.log(`     wrote: ${dir}`);
  process.exit(2);
}

// Stage rule + fixtures to .synth/<id>/. Always do this fresh.
rmSync(join(stageRoot, f.id), { recursive: true, force: true });
const staged = stageFinding(stageRoot, f);
console.log(`  staged rule:   ${staged.ruleFile}`);
console.log(`  staged vuln:   ${staged.vulnerableDir}`);
console.log(`  staged fixed:  ${staged.fixedDir}`);

// Gate 2: the staged rule must load (validates structure + kind binding).
let rules;
try {
  rules = loadRules(join(stageRoot, f.id, "rules"));
} catch (e: any) {
  const reason = `staged rule failed loadRules validation: ${e?.message ?? e}`;
  const dir = writeDraft(draftsRoot, f, reason);
  console.log(`  -> DRAFT: ${reason}`);
  console.log(`     wrote: ${dir}`);
  process.exit(2);
}

// Gate 3: RED on vulnerable. Exactly one check, this rule, result=fail.
const vulnResult = audit(staged.vulnerableDir, rules);
const vulnOk =
  vulnResult.checks.length === 1 &&
  vulnResult.checks[0].ruleId === f.id &&
  vulnResult.checks[0].result === "fail";
console.log(
  `  vulnerable -> ${vulnResult.checks.length} check(s): ` +
    `${vulnResult.checks[0]?.ruleId ?? "none"} = ${vulnResult.checks[0]?.result ?? "none"} ${vulnOk ? "[RED ✓]" : "[unexpected]"}`,
);

// Gate 4: GREEN on fixed. Exactly one check, this rule, result=pass.
const fixedResult = audit(staged.fixedDir, rules);
const fixedOk =
  fixedResult.checks.length === 1 &&
  fixedResult.checks[0].ruleId === f.id &&
  fixedResult.checks[0].result === "pass";
console.log(
  `  fixed      -> ${fixedResult.checks.length} check(s): ` +
    `${fixedResult.checks[0]?.ruleId ?? "none"} = ${fixedResult.checks[0]?.result ?? "none"} ${fixedOk ? "[GREEN ✓]" : "[unexpected]"}`,
);

if (vulnOk && fixedOk) {
  console.log(`\n  -> PROVEN. RED->GREEN holds with the existing vetted checker.`);
  console.log(`     promote with: cp ${staged.ruleFile} rules/  &&  cp -r ${staged.vulnerableDir}/* fixtures/<dir>/vulnerable/  (etc.)`);
  process.exit(0);
}

const reason =
  `proof failed: vulnerable=${vulnOk ? "RED" : "wrong"}, fixed=${fixedOk ? "GREEN" : "wrong"}. ` +
  `binding (check='${f.binding.check.kind}', test='${f.binding.test.kind}') is structurally unfit for this Finding's shape.`;
const dir = writeDraft(draftsRoot, f, reason);
console.log(`\n  -> DRAFT: ${reason}`);
console.log(`     wrote: ${dir}`);
process.exit(2);
