// ingest-vti — CLI for the Stage 2 contributor ingest gate (src/contrib/ingest.ts).
//
//   npm run ingest:vti -- --submission <dir> --trap <ruleId> \
//        [--consent opt-in:train+eval] [--corroboration 1]
//
// <dir> contains vulnerable/ and fixed/. The trap must map to a bundled rule
// (the grading oracle). Accepted records are APPENDED to a physically separate,
// git-ignored lot — datasets/contrib/contrib-vti.jsonl — never the owned corpus.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listBundledPacks } from "../src/bundledPacks.ts";
import { loadPack } from "../src/packs.ts";
import { ingestContribution, type ConsentScope } from "../src/contrib/ingest.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const resolve = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));

const submission = flag("--submission");
const trapId = flag("--trap");
const consent = (flag("--consent") ?? "opt-in:train+eval") as ConsentScope;
const corroboration = flag("--corroboration") ? Number(flag("--corroboration")) : undefined;

if (!submission || !trapId) {
  console.error("usage: npm run ingest:vti -- --submission <dir> --trap <ruleId> [--consent <scope>] [--corroboration <n>]");
  process.exit(2);
}

const VALID_CONSENT: ConsentScope[] = ["opt-in:train", "opt-in:eval", "opt-in:train+eval"];
if (!VALID_CONSENT.includes(consent)) {
  console.error(`invalid --consent ${consent}; must be one of ${VALID_CONSENT.join(", ")}`);
  process.exit(2);
}

// Resolve the trap's rule from the bundled packs (the oracle).
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

const result = ingestContribution({
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

// Accepted — append to the SEPARATE, git-ignored contributor lot.
const lotDir = join(repoRoot, "datasets", "contrib");
mkdirSync(lotDir, { recursive: true });
const lot = join(lotDir, "contrib-vti.jsonl");
appendFileSync(lot, JSON.stringify(result.vti) + "\n");
const count = existsSync(lot) ? readFileSync(lot, "utf8").split("\n").filter(Boolean).length : 1;
console.log(`\n  ✅ ACCEPTED — license=contributor-grant-v1 consent=${consent}`);
console.log(`     → datasets/contrib/contrib-vti.jsonl (${count} record(s); separate from the owned corpus)\n`);
