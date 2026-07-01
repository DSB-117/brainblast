// corpus-sla — Stage 3, Step 5 of ROADMAP-TRAINING-DATA.md.
//
// The contractual integrity surface for selling the corpus. Re-verifies, across
// every lot, the claims every earlier stage rests on:
//
//   1. REPRODUCTION  — re-prove each VTI's trap still goes RED→GREEN against its
//      rule (the reproduction-rate SLA; freshness decay shows up here first).
//   2. SCHEMA        — re-validate each record against schema/vti.schema.json
//      (back-fills a Stage 0 integrity check).
//   3. PACKAGING     — confirm the published datasets/v0.1.0 full lot is in sync
//      with datasets/seed (back-fills the Stage 1 drift gap).
//   4. FRESHNESS     — age distribution since capture.
//
// Emits datasets/SLA.md + datasets/sla.json. Exits non-zero on any integrity
// regression so it can gate CI / a release.
//
//   npm run sla            (from packages/core)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listBundledPacks } from "../src/bundledPacks.ts";
import { loadPack } from "../src/packs.ts";
import { resolveRules } from "../src/resolveRules.ts";
import { reproducePair } from "../src/contrib/ingest.ts";
import { dedupKey, type CorpusVti } from "../src/corpus.ts";
import { ALL_BACKENDS, tier2Enabled } from "../src/oracle/index.ts";
import type { Rule } from "../src/types.ts";

// A rule needs code EXECUTION to verify if a Tier-2 backend (executed-test /
// differential) binds it — the lower tiers only abstain on those kinds. The
// offline SLA can't re-run them without BRAINBLAST_ORACLE_EXEC, so they're counted
// UNVERIFIABLE (not a regression) — same posture as a missing pinned SDK.
function needsExecToVerify(rule: Rule): boolean {
  return ALL_BACKENDS.some((b) => b.tier >= 2 && b.supports(rule));
}

const GENERATOR = "corpus-sla@0.1.0";
const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const LICENSES = new Set(["synthetic-owned", "contributor-grant-v1"]);

const LOTS = [
  { name: "synthetic-owned", path: join(repoRoot, "datasets", "seed", "seed-vti.jsonl") },
  { name: "contributor-grant-v1", path: join(repoRoot, "datasets", "contrib", "contrib-vti.jsonl") },
];

function readLot(path: string): CorpusVti[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as CorpusVti);
}

// Minimal structural re-validation against the committed schema's required
// fields + enums (no jsonschema dep; the full validator is scripts/validate.sh).
function schemaValid(v: any): boolean {
  return (
    (v?.schemaVersion === "1.0" || v?.schemaVersion === "1.1") &&
    typeof v.trapId === "string" && v.trapId.length > 0 &&
    v.sdk && typeof v.sdk.name === "string" &&
    SEVERITIES.has(v.severity) &&
    typeof v.class === "string" &&
    v.vulnerable?.snippet && v.fixed?.snippet &&
    v.redGreenProof && typeof v.redGreenProof.red === "boolean" && typeof v.redGreenProof.green === "boolean" &&
    LICENSES.has(v.license) &&
    typeof v.consentScope === "string" &&
    typeof v.capturedAt === "string"
  );
}

// Resolve every trap's rule from project rules + every bundled pack.
const ruleById = new Map<string, Rule>();
for (const r of resolveRules(repoRoot, [])) ruleById.set(r.id, r);
for (const b of listBundledPacks()) for (const r of loadPack(b.dir).rules) if (!ruleById.has(r.id)) ruleById.set(r.id, r);

const now = Date.now();
const nowIso = new Date(now).toISOString();

interface LotReport {
  lot: string;
  total: number;
  schemaValid: number;
  reproduced: number;
  unverifiable: number; // rule for the trap not resolvable
  failures: { trapId: string; reason: string }[];
  ageDaysMedian: number;
  ageDaysMax: number;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const lotReports: LotReport[] = [];
let anyRegression = false;

for (const lot of LOTS) {
  const recs = readLot(lot.path);
  if (recs.length === 0 && !existsSync(lot.path)) continue;

  const failures: { trapId: string; reason: string }[] = [];
  let schemaOk = 0;
  let reproduced = 0;
  let unverifiable = 0;
  const ages: number[] = [];

  for (const v of recs) {
    if (schemaValid(v)) schemaOk++;
    else { failures.push({ trapId: v.trapId ?? "?", reason: "schema-invalid" }); anyRegression = true; }

    const capturedAt = Date.parse((v as any).capturedAt ?? "");
    if (!Number.isNaN(capturedAt)) ages.push((now - capturedAt) / 86_400_000);

    const rule = ruleById.get(v.trapId);
    if (!rule) { unverifiable++; continue; }

    // Behavioral / non-TS-Rust records (Tier-2) can't be re-proven offline; only a
    // run with BRAINBLAST_ORACLE_EXEC executes them. Count as unverifiable, not a
    // regression, so a Python/differential VTI in the corpus never falsely fails
    // the integrity gate.
    if (needsExecToVerify(rule) && !tier2Enabled()) { unverifiable++; continue; }

    const fname = (v.vulnerable as any)?.path ?? "candidate.ts";
    // Owned corpus, our machine → context "local". Re-proves through the
    // generalized prover, so executed-test/differential records re-verify too
    // (Tier-2 still gated by BRAINBLAST_ORACLE_EXEC).
    const { red, green } = await reproducePair(rule, (v.vulnerable as any)?.snippet ?? "", (v.fixed as any)?.snippet ?? "", fname, "local");
    if (red && green) reproduced++;
    else { failures.push({ trapId: v.trapId, reason: `no longer reproduces (RED=${red} GREEN=${green})` }); anyRegression = true; }
  }

  lotReports.push({
    lot: lot.name,
    total: recs.length,
    schemaValid: schemaOk,
    reproduced,
    unverifiable,
    failures,
    ageDaysMedian: Math.round(median(ages)),
    ageDaysMax: ages.length ? Math.round(Math.max(...ages)) : 0,
  });
}

// ── Packaging drift: published v0.1.0 full lot vs seed ──────────────────────────
function lotKeySet(path: string): Set<string> {
  return new Set(readLot(path).map((v) => dedupKey(v)));
}
const seedKeys = lotKeySet(join(repoRoot, "datasets", "seed", "seed-vti.jsonl"));
const packagedPath = join(repoRoot, "datasets", "v0.1.0", "full", "vti.jsonl");
let packaging: { checked: boolean; inSync: boolean; detail: string };
if (!existsSync(packagedPath)) {
  packaging = { checked: false, inSync: true, detail: "no packaged lot to check" };
} else {
  const packagedKeys = lotKeySet(packagedPath);
  const inSync = seedKeys.size === packagedKeys.size && [...seedKeys].every((k) => packagedKeys.has(k));
  packaging = { checked: true, inSync, detail: inSync ? "v0.1.0 full lot matches seed" : "v0.1.0 full lot DRIFTED from seed — run `npm run pack:dataset`" };
  if (!inSync) anyRegression = true;
}

// ── Aggregate ────────────────────────────────────────────────────────────────────
const total = lotReports.reduce((a, r) => a + r.total, 0);
const verifiable = lotReports.reduce((a, r) => a + (r.total - r.unverifiable), 0);
const reproduced = lotReports.reduce((a, r) => a + r.reproduced, 0);
const schemaOk = lotReports.reduce((a, r) => a + r.schemaValid, 0);
const reproductionRate = verifiable ? +(reproduced / verifiable).toFixed(4) : 1;
const schemaRate = total ? +(schemaOk / total).toFixed(4) : 1;

const sla = {
  schemaVersion: "1.0",
  generator: GENERATOR,
  generatedAt: nowIso,
  corpus: { total, verifiable, reproduced, schemaValid: schemaOk },
  rates: { reproduction: reproductionRate, schemaValid: schemaRate },
  packaging,
  lots: lotReports,
  regression: anyRegression,
};

const outDir = join(repoRoot, "datasets");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "sla.json"), JSON.stringify(sla, null, 2) + "\n");

const md = `# Corpus SLA — Brainblast Verified Traps

_Generated ${nowIso} by ${GENERATOR}. Source of truth: \`datasets/sla.json\`._

## Headline
- **Reproduction rate: ${(reproductionRate * 100).toFixed(1)}%** (${reproduced}/${verifiable} verifiable VTIs still go RED→GREEN).
- **Schema-valid: ${(schemaRate * 100).toFixed(1)}%** (${schemaOk}/${total}).
- **Packaging:** ${packaging.detail}.
- **Integrity gate:** ${anyRegression ? "❌ REGRESSION" : "✅ PASS"}.

## Per-lot
| lot | total | schema-valid | reproduced | unverifiable | age median (d) | age max (d) |
|---|---|---|---|---|---|---|
${lotReports.map((r) => `| ${r.lot} | ${r.total} | ${r.schemaValid} | ${r.reproduced} | ${r.unverifiable} | ${r.ageDaysMedian} | ${r.ageDaysMax} |`).join("\n")}

${lotReports.some((r) => r.failures.length) ? "## Failures\n" + lotReports.flatMap((r) => r.failures.map((f) => `- [${r.lot}] \`${f.trapId}\` — ${f.reason}`)).join("\n") : "_No failures._"}

## Notes
- **Reproduction** is the freshness/decay signal: a trap that stops reproducing
  means the SDK moved under it (re-research needed) or the data was tampered.
- "Median age from SDK release to VTI" (the sharper freshness metric) needs SDK
  release dates as an input — a Stage 3 follow-up; today's age is since capture.
- \`unverifiable\` = the trap's rule isn't resolvable locally (e.g. a contributed
  trap from a pack not installed); not counted against the reproduction rate.
`;
writeFileSync(join(outDir, "SLA.md"), md);

console.log(`\nCorpus SLA — ${GENERATOR}`);
console.log(`  reproduction: ${(reproductionRate * 100).toFixed(1)}% (${reproduced}/${verifiable})  ·  schema-valid: ${(schemaRate * 100).toFixed(1)}% (${schemaOk}/${total})`);
console.log(`  packaging: ${packaging.inSync ? "in sync" : "DRIFTED"}  ·  integrity gate: ${anyRegression ? "❌ REGRESSION" : "✅ PASS"}`);
console.log(`  → datasets/sla.json, datasets/SLA.md\n`);
process.exit(anyRegression ? 1 : 0);
