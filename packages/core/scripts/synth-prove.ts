import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { proveFinding, writeDraft } from "../src/synth/index.ts";
import type { Finding } from "../src/synth/index.ts";

// PROOF-AS-CLASSIFIER ORCHESTRATOR.
//
// One job: take a research Finding and route it. No taste, no LLM — it runs the
// SHARED gate (`proveFinding`, the same one the fleet uses) through the
// generalized oracle (static → compiler → executed → differential) and the
// RED->GREEN result decides.
//
//   exit 0  PROVEN — the rule goes RED on vulnerable + GREEN on fixed. Safe to
//           promote to packs/ (the fleet auto-promotes).
//   exit 2  DRAFT  — unvetted kind, load failure, or the colors didn't hold.
//           Written to packages/core/drafts/<id>/ for review. NEVER promoted.
//   exit 1  failure — bad inputs.
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

const outcome = await proveFinding(f, stageRoot);

if (outcome.verdict === "PROVEN") {
  const corr = outcome.corroborations?.length ? ` (+${outcome.corroborations.join(", ")})` : "";
  console.log(`  proof: RED→GREEN via ${outcome.method}${corr}`);
  if (outcome.staged) console.log(`  staged: ${outcome.staged.ruleFile}`);
  console.log(`\n  -> PROVEN. Safe to promote (\`npm run fleet\` auto-promotes proven candidates).`);
  process.exit(0);
}

const dir = writeDraft(draftsRoot, f, outcome.reason ?? "proof failed");
console.log(`\n  -> DRAFT: ${outcome.reason}`);
console.log(`     wrote: ${dir}`);
process.exit(2);
