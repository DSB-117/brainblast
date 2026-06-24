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

// ── corpus-index.json ───────────────────────────────────────────────────────────
const { schemaVersion, ...indexRest } = index;
const indexOut = { schemaVersion, generator: GENERATOR, generatedAt: now, lots: lotsPresent, ...indexRest };
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
${index.coverage.thinCells.length === 0 ? "_No thin cells._" : "**Thin cells** (only one instance — corroborate or broaden):\n" + index.coverage.thinCells.map((c) => `- ${c.class} · ${c.sdk}`).join("\n")}

${index.coverage.missingClasses.length === 0 ? "_All trap classes have at least one instance._" : "**Uncovered trap classes** (no instance yet):\n" + index.coverage.missingClasses.map((c) => `- ${c}`).join("\n")}

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
