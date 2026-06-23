// pack-dataset — Stage 1, Step 2 of ROADMAP-TRAINING-DATA.md.
//
// Turns the raw seed VTIs (datasets/seed/seed-vti.jsonl) into a VERSIONED,
// LICENSED dataset product:
//
//   datasets/v<version>/
//     sample/vti.jsonl   — OPEN lot: a small teaser, openly licensed so a buyer
//                          can inspect format/quality before purchase.
//     full/vti.jsonl     — $BRAIN-GATED lot: the maintained, growing corpus.
//     datasheet.md       — Datasheets-for-Datasets provenance/composition/use.
//     index.json         — version, counts, class distribution, access+pricing
//                          (USD, $BRAIN-discounted, USDC->buyback settlement).
//     SHA256SUMS         — tamper-evidence over every file in the release.
//
//   npm run pack:dataset           (from packages/core)

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DATASET_VERSION = "0.1.0";
const SAMPLE_SIZE = 3; // open teaser size
const GENERATOR = "pack-dataset@0.1.0";

// $BRAIN access model (ROADMAP-TRAINING-DATA.md token table). USDC is the
// on-ramp; $BRAIN is the discounted unit of access; USDC payments buy back $BRAIN.
const BRAIN_DISCOUNT_PCT = 10;
const FULL_LOT_PRICE_USD = 2500; // indicative launch price for the maintained corpus

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const seedPath = join(repoRoot, "datasets", "seed", "seed-vti.jsonl");
const outDir = join(repoRoot, "datasets", `v${DATASET_VERSION}`);

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── Load & split ──────────────────────────────────────────────────────────────
const records = readFileSync(seedPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, any>)
  .sort((a, b) => String(a.trapId).localeCompare(String(b.trapId)));

if (records.length === 0) {
  console.error("no VTIs in datasets/seed/seed-vti.jsonl — run `npm run gen:vti` first");
  process.exit(1);
}

const sample = records.slice(0, Math.min(SAMPLE_SIZE, records.length));
const full = records;

// ── Class / severity distribution ──────────────────────────────────────────────
function distribution(recs: Record<string, any>[], key: string): Record<string, number> {
  const d: Record<string, number> = {};
  for (const r of recs) d[r[key]] = (d[r[key]] ?? 0) + 1;
  return d;
}
const classDist = distribution(full, "class");
const sevDist = distribution(full, "severity");
const sdks = [...new Set(full.map((r) => r.sdk.name))].sort();
const now = new Date().toISOString();

// ── Write lots ──────────────────────────────────────────────────────────────────
mkdirSync(join(outDir, "sample"), { recursive: true });
mkdirSync(join(outDir, "full"), { recursive: true });
const toJsonl = (recs: Record<string, any>[]) => recs.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(join(outDir, "sample", "vti.jsonl"), toJsonl(sample));
writeFileSync(join(outDir, "full", "vti.jsonl"), toJsonl(full));

// ── index.json (hashes live in SHA256SUMS, not here, to avoid circularity) ──────
const index = {
  schemaVersion: "1.0",
  dataset: "brainblast-verified-traps",
  version: DATASET_VERSION,
  generator: GENERATOR,
  generatedAt: now,
  recordSchema: "schema/vti.schema.json",
  license: "synthetic-owned",
  consentScope: "owned",
  counts: { full: full.length, sample: sample.length, sdks: sdks.length },
  classDistribution: classDist,
  severityDistribution: sevDist,
  sdks,
  lots: {
    sample: {
      file: "sample/vti.jsonl",
      access: "open",
      price: null,
      note: "Openly licensed teaser for format/quality inspection.",
    },
    full: {
      file: "full/vti.jsonl",
      access: "brain-gated",
      priceUsd: FULL_LOT_PRICE_USD,
      brainDiscountPct: BRAIN_DISCOUNT_PCT,
      priceBrainUsdEquivalent: +(FULL_LOT_PRICE_USD * (1 - BRAIN_DISCOUNT_PCT / 100)).toFixed(2),
      settlement: ["BRAIN", "USDC->buyback"],
      note: "Pay in $BRAIN at a standing discount; USDC accepted and used to buy back $BRAIN into the contributor/burn pool.",
    },
  },
};
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");

// ── Datasheet ─────────────────────────────────────────────────────────────────
const datasheet = `# Datasheet — Brainblast Verified Traps v${DATASET_VERSION}

_Generated ${now} by ${GENERATOR}. Records conform to [\`schema/vti.schema.json\`](../../schema/vti.schema.json)._

## Motivation
A corpus of **machine-verified \`error → fix → proof\` records** for real SDK
integration traps. Each record is *reward-gradable*: Brainblast's own static
checker fails (RED) on the vulnerable code and passes (GREEN) on the fix. This is
the property scraped bug data lacks. See [\`ROADMAP-TRAINING-DATA.md\`](../../ROADMAP-TRAINING-DATA.md).

## Composition
- **Records:** ${full.length} (full lot), ${sample.length} (open sample).
- **SDKs covered (${sdks.length}):** ${sdks.join(", ")}.
- **Class distribution:** ${Object.entries(classDist).map(([k, v]) => `${k}=${v}`).join(", ")}.
- **Severity distribution:** ${Object.entries(sevDist).map(([k, v]) => `${k}=${v}`).join(", ")}.
- Each record carries: vulnerable + fixed snippet, checker fail/pass detail,
  RED→GREEN proof, source-doc URL, producing pack, severity, and trap class.

## Collection process
Generated by \`packages/core/scripts/gen-vti.ts\` from Brainblast's own bundled
rule packs. A record is emitted **only if** the pack proves RED→GREEN through the
same gate as \`brainblast pack validate\`. No web scraping; no user code.

## Provenance & license
- **License:** \`synthetic-owned\` — produced entirely from Brainblast-owned
  packs/fixtures. **Zero third-party consent obligation.**
- Contributor-sourced data (Stage 2) is a **separate** lot and never mixed in.

## Access & settlement ($BRAIN)
- **sample/** — open, free to inspect.
- **full/** — \`$BRAIN\`-gated. Indicative price **$${FULL_LOT_PRICE_USD} USD**,
  payable in **\`$BRAIN\` at a ${BRAIN_DISCOUNT_PCT}% discount**
  (~$${index.lots.full.priceBrainUsdEquivalent} equiv.). USDC accepted and used to
  **buy back \`$BRAIN\`** into the contributor/burn pool.

## Intended use
Post-training / RL reward modeling and evaluation on *current-SDK* integration
correctness. Pairs with the benchmark in [\`bench/\`](../../bench/).

## Limitations (be honest with buyers)
- **Small & synthetic** at v${DATASET_VERSION}; volume/freshness arrive when the
  \`brainblast-scout\` supply engine runs across more SDKs (Stage 3).
- **Solana-heavy** — reflects today's bundled packs.
- Static-checker oracle: a \`cant_tell\` is treated as "trap avoided" (matches the
  prove gate); it is not positive confirmation of correctness beyond the trap.

## Maintenance
Regenerate: \`cd packages/core && npm run gen:vti && npm run pack:dataset\`.
Integrity: see \`SHA256SUMS\` (verify with \`shasum -c SHA256SUMS\`).
`;
writeFileSync(join(outDir, "datasheet.md"), datasheet);

// ── SHA256SUMS over every release file ──────────────────────────────────────────
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "SHA256SUMS") continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const sums = walk(outDir)
  .sort()
  .map((p) => `${sha256(readFileSync(p))}  ${relative(outDir, p)}`)
  .join("\n") + "\n";
writeFileSync(join(outDir, "SHA256SUMS"), sums);

// ── Report ──────────────────────────────────────────────────────────────────────
console.log(`\nDataset packaged — ${GENERATOR}`);
console.log(`  version:  v${DATASET_VERSION}`);
console.log(`  full:     ${full.length} VTIs (${sdks.length} SDKs)  →  datasets/v${DATASET_VERSION}/full/vti.jsonl  [$BRAIN-gated]`);
console.log(`  sample:   ${sample.length} VTIs                       →  datasets/v${DATASET_VERSION}/sample/vti.jsonl [open]`);
console.log(`  classes:  ${JSON.stringify(classDist)}`);
console.log(`  files:    index.json, datasheet.md, SHA256SUMS`);
console.log(`  ✅ packaged\n`);
