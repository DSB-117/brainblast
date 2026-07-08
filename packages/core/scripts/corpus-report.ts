// corpus-report — Stage 3 of ROADMAP-TRAINING-DATA.md.
//
// Reads every VTI lot (owned seed + contributor, if present), scores and
// de-duplicates the corpus, and emits:
//   datasets/corpus-index.json — machine-readable corpus intelligence
//   datasets/COVERAGE.md        — class×SDK heatmap + scout work-orders
//
//   npm run corpus            (from packages/core)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCorpusIndex, type CorpusVti } from "../src/corpus.ts";
import { hiveRoot } from "../src/hive/store.ts";
import { statsPath, type DemandSignal } from "../src/hive/stats.ts";

const GENERATOR = "corpus-report@0.1.0";
const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

// Every lot we know about. Owned seed is always present; the contributor lot is
// git-ignored and only exists locally once contributions have been ingested.
const LOTS = [
  { path: join(repoRoot, "datasets", "seed", "seed-vti.jsonl"), license: "synthetic-owned" },
  { path: join(repoRoot, "datasets", "contrib", "contrib-vti.jsonl"), license: "contributor-grant-v1" },
];

function readLot(path: string): CorpusVti[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CorpusVti);
}

const lotsPresent: { path: string; license: string; count: number }[] = [];
const vtis: CorpusVti[] = [];
for (const lot of LOTS) {
  const recs = readLot(lot.path);
  if (recs.length || existsSync(lot.path)) lotsPresent.push({ path: lot.path.slice(repoRoot.length + 1), license: lot.license, count: recs.length });
  vtis.push(...recs);
}

if (vtis.length === 0) {
  console.error("no VTIs found — run `npm run gen:vti` first");
  process.exit(1);
}

const index = buildCorpusIndex(vtis);
const now = new Date().toISOString();

// HiveMind demand signal (optional): `brainblast hive stats` writes anonymized
// fix-event counts — where agents on real machines ACTUALLY shipped a trap and
// fixed it. When present, work-orders below are demand-weighted: a thin cell
// real agents keep hitting outranks a thin cell nobody has hit.
let demand: DemandSignal | undefined;
try {
  const p = statsPath(hiveRoot());
  if (existsSync(p)) {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (parsed?.schemaVersion === "1.0" && parsed.totalFixEvents > 0) demand = parsed as DemandSignal;
  }
} catch {
  // demand weighting is advisory — a bad stats file never breaks the report
}

// ── corpus-index.json ───────────────────────────────────────────────────────────
const { schemaVersion, ...indexRest } = index;
const indexOut = {
  schemaVersion,
  generator: GENERATOR,
  generatedAt: now,
  lots: lotsPresent,
  ...indexRest,
  ...(demand ? { fieldDemand: demand } : {}),
};
const outDir = join(repoRoot, "datasets");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "corpus-index.json"), JSON.stringify(indexOut, null, 2) + "\n");

// ── COVERAGE.md ─────────────────────────────────────────────────────────────────
const sdks = Object.keys(index.sdkDistribution).sort();
const classes = Object.keys(index.coverage.matrix).sort();
const header = `| class \\ sdk | ${sdks.join(" | ")} |`;
const sep = `|${"---|".repeat(sdks.length + 1)}`;
const rows = classes.map((cls) => {
  const cells = sdks.map((s) => {
    const n = index.coverage.matrix[cls]?.[s] ?? 0;
    return n === 0 ? "·" : String(n);
  });
  return `| ${cls} | ${cells.join(" | ")} |`;
});

const md = `# Corpus coverage — Brainblast Verified Traps

_Generated ${now} by ${GENERATOR}. Source of truth: \`datasets/corpus-index.json\`._

## Summary
- **${index.counts.vtis}** VTIs (${index.counts.unique} unique, ${index.counts.duplicates} duplicate) across **${index.counts.sdks}** SDKs and **${index.counts.classes}** trap classes.
- **Quality** (0–100): mean ${index.quality.mean}, median ${index.quality.median}, range ${index.quality.min}–${index.quality.max}.
  Buckets — high (≥70): ${index.quality.buckets.high}, medium (40–69): ${index.quality.buckets.medium}, low (<40): ${index.quality.buckets.low}.
- **Lots:** ${lotsPresent.map((l) => `${l.license} (${l.count})`).join(", ")}.

## Coverage heatmap (class × SDK, unique records)
${header}
${sep}
${rows.join("\n")}

(\`·\` = no coverage yet.)

## Scout work-orders (where to dig next)
${index.coverage.thinCells.length === 0 ? "_No thin cells._" : "**Thin cells** (only one instance — corroborate or broaden):\n" + index.coverage.thinCells
  .map((c) => {
    const hits = (demand?.byClass[c.class] ?? 0) + (demand?.bySdk[c.sdk] ?? 0);
    return { c, hits };
  })
  .sort((a, b) => b.hits - a.hits)
  .map(({ c, hits }) => `- ${c.class} · ${c.sdk}${hits > 0 ? `  ⚑ field demand: ${hits} observed fix event${hits === 1 ? "" : "s"}` : ""}`)
  .join("\n")}

${index.coverage.missingClasses.length === 0 ? "_All trap classes have at least one instance._" : "**Uncovered trap classes** (no instance yet):\n" + index.coverage.missingClasses.map((c) => `- ${c}`).join("\n")}
${
  demand
    ? `\n## Field demand (HiveMind, anonymized)\n_${demand.totalFixEvents} observed fix events across ${demand.repos} repos (counts only — \`brainblast hive stats\`). Where real agents actually shipped a trap and fixed it; weight scout effort accordingly._\n${Object.entries(
        demand.byRule,
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([rule, n]) => `- ${rule} ×${n}`)
        .join("\n")}\n`
    : ""
}

## $BRAIN curation
The per-record \`score\` in \`corpus-index.json\` is what pricing and the curation
market key off: buyers filter on it, and stakers can **stake \`$BRAIN\` to up-rank**
a trap they believe labs will pay for (earning on usage, losing on disuse). Thin
cells and uncovered classes above are the scout work-orders that staking funds.
`;
writeFileSync(join(outDir, "COVERAGE.md"), md);

// ── Report ───────────────────────────────────────────────────────────────────────
console.log(`\nCorpus report — ${GENERATOR}`);
console.log(`  ${index.counts.vtis} VTIs (${index.counts.unique} unique, ${index.counts.duplicates} dup) · ${index.counts.sdks} SDKs · ${index.counts.classes} classes`);
console.log(`  quality: mean ${index.quality.mean}, median ${index.quality.median} (high ${index.quality.buckets.high} / med ${index.quality.buckets.medium} / low ${index.quality.buckets.low})`);
console.log(`  thin cells: ${index.coverage.thinCells.length} · uncovered classes: ${index.coverage.missingClasses.length}`);
console.log(`  → datasets/corpus-index.json, datasets/COVERAGE.md\n`);
