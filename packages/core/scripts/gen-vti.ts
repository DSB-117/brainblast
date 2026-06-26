// gen-vti — Stage 0 of ROADMAP-TRAINING-DATA.md.
//
// Turns every bundled rule pack into a Verified Trap Instance (VTI): the
// sellable atom of the training-data platform. For each pack we run Brainblast's
// OWN audit() over the vulnerable and fixed fixtures and REQUIRE RED→GREEN
// (rule fails on vulnerable, passes on fixed) before emitting a record — so the
// proof is genuine, not asserted. Every record is `synthetic-owned`: produced
// entirely from our own packs, carrying zero third-party consent obligation.
//
// Output (committable data asset):
//   datasets/seed/seed-vti.jsonl   — one VTI per line (feed-native NDJSON)
//   datasets/seed/manifest.json    — counts, class distribution, proof status
//
//   npm run gen:vti            (from packages/core)

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditWithRule } from "../src/audit.ts";
import { listBundledPacks } from "../src/bundledPacks.ts";
import { loadPack } from "../src/packs.ts";
import { validatePack } from "../src/pack.ts";
import { TRAP_CLASSES, classifyTrap } from "../src/vtiClass.ts";
import type { CheckResult, Rule } from "../src/types.ts";

const GENERATOR = "gen-vti@0.2.0";
const SCHEMA_VERSION = "1.1";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const outDir = join(repoRoot, "datasets", "seed");

// Trap taxonomy lives in ../src/vtiClass.ts (shared with the contributor ingest
// pipeline so the two can never drift).

// ── Helpers ───────────────────────────────────────────────────────────────────
// The RED check (first fail) carries the failDetail and the file the trap lives
// in; the fixed side may legitimately be `pass` OR `cant_tell` (e.g. a non-literal
// minOutAmount the checker can't statically confirm) — validatePack already
// accepted it as GREEN, so any check is fine for the detail/path here.
function firstFail(dir: string, rule: Rule): CheckResult | undefined {
  return auditWithRule(dir, rule).find((c) => c.result === "fail");
}

function anyCheck(dir: string, rule: Rule): CheckResult | undefined {
  return auditWithRule(dir, rule)[0];
}

// First real source file in a fixture dir, recursively — skips directories and
// dot-entries (e.g. a stray .agent-research/ output dir) so the fallback never
// tries to readFileSync a directory.
function firstFixtureFile(dir: string): string | undefined {
  for (const e of readdirSync(dir)) {
    if (e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isFile()) return p;
    if (statSync(p).isDirectory()) {
      const nested = firstFixtureFile(p);
      if (nested) return nested;
    }
  }
  return undefined;
}

function snippetFor(check: CheckResult | undefined, dir: string): { path: string; snippet: string } {
  // Prefer the file the checker fired on; fall back to the first fixture file.
  let file = check?.file;
  if (!file || !existsSync(file) || statSync(file).isDirectory()) {
    file = firstFixtureFile(dir) ?? "";
  }
  return { path: file ? file.slice(repoRoot.length + 1) : "", snippet: file ? readFileSync(file, "utf8") : "" };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const now = new Date().toISOString();
const records: Record<string, unknown>[] = [];
const proofLog: { pack: string; rule: string; red: boolean; green: boolean; emitted: boolean; note?: string }[] = [];

for (const bundled of listBundledPacks()) {
  const { manifest, rules } = loadPack(bundled.dir);
  // The authoritative prove gate — the SAME one `brainblast pack validate` and
  // the bundled-pack tests run. status "ok" === RED→GREEN proven for that rule.
  const { ruleResults } = validatePack(bundled.dir);
  const statusOf = new Map(ruleResults.map((r) => [r.ruleId, r] as const));

  for (const rule of rules) {
    const vr = statusOf.get(rule.id);
    if (!vr || vr.status !== "ok") {
      proofLog.push({
        pack: manifest.id, rule: rule.id,
        red: vr?.status !== "red-failed" && vr?.status !== "missing-fixtures",
        green: vr?.status === "ok",
        emitted: false,
        note: vr ? `${vr.status}: ${vr.detail}` : "rule not validated",
      });
      continue;
    }

    const base = join(bundled.dir, "fixtures", rule.id);
    const vulnDir = join(base, "vulnerable");
    const fixedDir = join(base, "fixed");

    const lang = (rule.detect.lang ?? "typescript") as "typescript" | "rust" | "config";
    const vulnTarget = firstFail(vulnDir, rule);
    const fixedTarget = anyCheck(fixedDir, rule);
    const vuln = snippetFor(vulnTarget, vulnDir);
    const fixed = snippetFor(fixedTarget, fixedDir);
    const sourceUrls = rule.component.sourceUrl ? [rule.component.sourceUrl] : [];

    records.push({
      schemaVersion: SCHEMA_VERSION,
      trapId: rule.id,
      title: rule.title,
      sdk: { name: rule.component.name, version: rule.component.version ?? null, type: rule.component.type ?? null },
      severity: rule.severity,
      class: classifyTrap(rule),
      vulnerable: { lang, path: vuln.path, snippet: vuln.snippet, detail: vulnTarget?.detail ?? null },
      fixed: { lang, path: fixed.path, snippet: fixed.snippet, detail: fixedTarget?.detail ?? null },
      // All bundled rules use test.kind: none — the static checker IS the proof
      // (same treatment Rust rules get in scripts/prove.ts). Generated tests are
      // attached here once a pack ships a real test.kind.
      generatedTest: null,
      // v0.9.2 — record the TRUE proving method. validatePack (main's oracle-aware
      // gate) proves each rule with whichever backend can: a `compiles-against-sdk`
      // pack is "ok" via the compiler, not the static checker. Emit that, instead
      // of the old hard-coded "static-checker".
      redGreenProof: {
        red: true,
        green: true,
        method: vr.method ?? "static-checker",
        checkKind: rule.check?.kind ?? null,
        verifiedAt: now,
      },
      provenance: {
        sourceUrls,
        pack: { id: manifest.id, version: manifest.version, author: manifest.author ?? null },
        exploit: rule.exploit ?? null,
        generator: GENERATOR,
      },
      corroborationCount: 0,
      license: "synthetic-owned",
      consentScope: "owned",
      capturedAt: now,
    });
    proofLog.push({ pack: manifest.id, rule: rule.id, red: true, green: true, emitted: true });
  }
}

// ── Lightweight structural validation (no extra deps) ─────────────────────────
// Full JSON-Schema validation is run separately against schema/vti.schema.json
// (see scripts/validate.sh); this catches mistakes at generation time.
const SEV = new Set(["critical", "high", "medium", "low"]);
const CLASSES = new Set<string>(TRAP_CLASSES);
let invalid = 0;
for (const r of records as any[]) {
  const ok =
    r.schemaVersion === SCHEMA_VERSION &&
    typeof r.trapId === "string" && r.trapId.length > 0 &&
    r.sdk && typeof r.sdk.name === "string" &&
    SEV.has(r.severity) && CLASSES.has(r.class) &&
    r.vulnerable?.snippet && r.fixed?.snippet &&
    r.redGreenProof?.red === true && r.redGreenProof?.green === true &&
    r.license === "synthetic-owned" && r.consentScope === "owned";
  if (!ok) { invalid++; console.error(`  ✗ invalid record: ${r.trapId}`); }
}

// ── Write outputs ─────────────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true });
const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
writeFileSync(join(outDir, "seed-vti.jsonl"), jsonl);

const classDist: Record<string, number> = {};
const sdkSet = new Set<string>();
for (const r of records as any[]) {
  classDist[r.class] = (classDist[r.class] ?? 0) + 1;
  sdkSet.add(r.sdk.name);
}
const manifest = {
  schemaVersion: SCHEMA_VERSION,
  generator: GENERATOR,
  generatedAt: now,
  license: "synthetic-owned",
  consentScope: "owned",
  counts: { records: records.length, sdks: sdkSet.size, packsScanned: listBundledPacks().length },
  classDistribution: classDist,
  proof: proofLog,
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\nVTI seed generation — ${GENERATOR}`);
for (const p of proofLog) {
  const mark = p.emitted ? "✅" : "⏭️ ";
  console.log(`  ${mark} ${p.rule.padEnd(38)} RED=${p.red} GREEN=${p.green}${p.note ? `  (${p.note})` : ""}`);
}
console.log(`\n  ${records.length} VTI(s) across ${sdkSet.size} SDK(s) → ${join("datasets", "seed", "seed-vti.jsonl")}`);
console.log(`  class distribution: ${JSON.stringify(classDist)}`);
if (invalid > 0) {
  console.error(`\n  ❌ ${invalid} record(s) failed structural validation`);
  process.exit(1);
}
console.log(`  ✅ all records structurally valid\n`);
