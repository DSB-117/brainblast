// catalog — Stage 4 Step 2 of ROADMAP-TRAINING-DATA.md.
//
// Reads every VTI lot (owned seed + contributor, if present) and emits the
// buyer-facing storefront:
//   datasets/catalog.json — machine-readable catalog (coverage, tiers, teasers)
//   datasets/CATALOG.md   — the human storefront (committed, like COVERAGE.md)
//
//   npm run catalog            (from packages/core)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, renderCatalogMd } from "../src/marketplace.ts";
import type { CorpusVti } from "../src/corpus.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

const LOTS = [
  join(repoRoot, "datasets", "seed", "seed-vti.jsonl"),
  join(repoRoot, "datasets", "contrib", "contrib-vti.jsonl"),
];

function readLot(path: string): CorpusVti[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CorpusVti);
}

const present = LOTS.filter(existsSync);
const vtis: CorpusVti[] = present.flatMap(readLot);

const catalog = buildCatalog(vtis);
const datasetsDir = join(repoRoot, "datasets");
mkdirSync(datasetsDir, { recursive: true });
writeFileSync(join(datasetsDir, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
writeFileSync(join(datasetsDir, "CATALOG.md"), renderCatalogMd(catalog, present));

console.log(`Catalog — ${catalog.counts.proven} verified traps · ${catalog.counts.sdks} SDKs · ${catalog.counts.classes} classes`);
console.log(`  → datasets/catalog.json, datasets/CATALOG.md`);
