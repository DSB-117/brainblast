// ingest-vti — CLI for the Stage 2 contributor ingest gate (src/contrib/ingest.ts).
//
// Two modes:
//   Single submission (a vulnerable/ + fixed/ directory pair):
//     npm run ingest:vti -- --submission <dir> --trap <ruleId> \
//          [--consent opt-in:train+eval] [--corroboration 1]
//
//   Drain captured candidates staged by `brainblast fix --apply` (opt-in):
//     npm run ingest:vti -- --from-staging <projectDir>
//
// Accepted records are APPENDED to a physically separate, git-ignored lot —
// datasets/contrib/contrib-vti.jsonl — never the owned corpus.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listBundledPacks } from "../src/bundledPacks.ts";
import { loadPack } from "../src/packs.ts";
import { resolveRules } from "../src/resolveRules.ts";
import { ingestCandidate, ingestContribution, type ConsentScope, type IngestResult } from "../src/contrib/ingest.ts";
import { listStagedContributions } from "../src/contrib/capture.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const resolve = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));

const lotDir = join(repoRoot, "datasets", "contrib");
const lotPath = join(lotDir, "contrib-vti.jsonl");
function appendToLot(vti: unknown): number {
  mkdirSync(lotDir, { recursive: true });
  appendFileSync(lotPath, JSON.stringify(vti) + "\n");
  return existsSync(lotPath) ? readFileSync(lotPath, "utf8").split("\n").filter(Boolean).length : 1;
}

// ── Drain mode ────────────────────────────────────────────────────────────────
const fromStaging = flag("--from-staging");
if (fromStaging !== undefined) {
  const projectDir = resolve(fromStaging || ".");
  // Resolve traps from the project's active rules AND every bundled pack — a
  // captured trap may come from an opt-in protocol pack the project didn't
  // explicitly enable, but the rule (the oracle) still ships with brainblast.
  const ruleById = new Map<string, Rule>();
  for (const r of resolveRules(projectDir, [])) ruleById.set(r.id, r);
  for (const b of listBundledPacks()) for (const r of loadPack(b.dir).rules) if (!ruleById.has(r.id)) ruleById.set(r.id, r);
  const staged = listStagedContributions(projectDir);
  if (staged.length === 0) {
    console.log(`No staged contributions in ${projectDir}/.agent-research/contrib-staging/`);
    process.exit(0);
  }
  let accepted = 0;
  let rejected = 0;
  for (const { path, rec } of staged) {
    const rule = ruleById.get(rec.ruleId);
    if (!rule) {
      console.error(`  ⏭️  ${rec.ruleId}: no matching rule resolvable in ${projectDir} — left staged`);
      rejected++;
      continue;
    }
    const res: IngestResult = await ingestCandidate({
      rule,
      file: rec.file,
      vulnerableSource: rec.vulnerable,
      fixedSource: rec.fixed,
      consentScope: rec.consentScope as ConsentScope,
    });
    if (res.accepted) {
      const n = appendToLot(res.vti);
      rmSync(path, { force: true }); // consumed
      accepted++;
      console.log(`  ✅ ${rec.ruleId}: accepted → contrib lot (${n} record(s))`);
    } else {
      rejected++;
      console.error(`  ❌ ${rec.ruleId}: ${res.reasons.join("; ")} — left staged`);
    }
  }
  console.log(`\nDrained: ${accepted} accepted, ${rejected} left staged.`);
  process.exit(0);
}

// ── Single-submission mode ──────────────────────────────────────────────────────
const submission = flag("--submission");
const trapId = flag("--trap");
const consent = (flag("--consent") ?? "opt-in:train+eval") as ConsentScope;
const corroboration = flag("--corroboration") ? Number(flag("--corroboration")) : undefined;

if (!submission || !trapId) {
  console.error("usage:\n  ingest:vti -- --submission <dir> --trap <ruleId> [--consent <scope>] [--corroboration <n>]\n  ingest:vti -- --from-staging <projectDir>");
  process.exit(2);
}

const VALID_CONSENT: ConsentScope[] = ["opt-in:train", "opt-in:eval", "opt-in:train+eval"];
if (!VALID_CONSENT.includes(consent)) {
  console.error(`invalid --consent ${consent}; must be one of ${VALID_CONSENT.join(", ")}`);
  process.exit(2);
}

let rule: Rule | undefined;
for (const b of listBundledPacks()) {
  const found = loadPack(b.dir).rules.find((r) => r.id === trapId);
  if (found) { rule = found; break; }
}
if (!rule) {
  console.error(`unknown trap "${trapId}" — not a bundled rule. Available:`);
  for (const b of listBundledPacks()) for (const r of loadPack(b.dir).rules) console.error(`  ${r.id}`);
  process.exit(2);
}

const result = await ingestContribution({
  submissionDir: resolve(submission),
  rule,
  consentScope: consent,
  corroborationCount: corroboration,
});

console.log(`\nContributor ingest — trap ${result.trapId}`);
console.log(`  secret scan:  ${result.secretsFound.length === 0 ? "clean" : result.secretsFound.length + " hit(s): " + result.secretsFound.map((s) => `${s.file}:${s.kind}`).join(", ")}`);
console.log(`  reproduction: RED=${result.proof.red} GREEN=${result.proof.green}`);

if (!result.accepted) {
  console.error(`\n  ❌ REJECTED`);
  for (const r of result.reasons) console.error(`     - ${r}`);
  process.exit(1);
}

const count = appendToLot(result.vti);
console.log(`\n  ✅ ACCEPTED — license=contributor-grant-v1 consent=${consent}`);
console.log(`     → datasets/contrib/contrib-vti.jsonl (${count} record(s); separate from the owned corpus)\n`);
