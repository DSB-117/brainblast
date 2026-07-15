// export:cleanroom — one command that turns the corpus into the sellable,
// legally-defensible NDJSON described in datasets/marketplace/OPENDATABAY-PACKAGE.md.
//
//   npm run export:cleanroom -- --source datasets/v0.1.0/full/vti.jsonl \
//     --tier owned --out dist/marketplace
//   npm run export:cleanroom -- --source ../../fleet/candidates --tier all \
//     --verify-provenance --exclude-copyleft
//
// Pipeline per record: toCleanroom() → (optional) fetch+verify the pinned pointer
// → (optional) upstream-license detect + copyleft filter → validateCleanroom()
// gate → write. A record that fails the gate is DROPPED and logged; the sold set
// is only what passed.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { toCleanroom, validateCleanroom, parseSourceRef, sha256, type CleanroomRecord } from "../src/marketplace/cleanroom.ts";
import { detectUpstreamLicense } from "../src/marketplace/upstreamLicense.ts";

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; }
function flag(n: string) { return process.argv.includes(`--${n}`); }

const SOURCE = arg("source", "datasets/v0.1.0/full/vti.jsonl")!;
const TIER = (arg("tier", "all") as "owned" | "wild" | "all");
const OUT = arg("out", "dist/marketplace")!;
const LIMIT = Number(arg("limit", "100000"));
const VERIFY = flag("verify-provenance");
const EXCLUDE_COPYLEFT = flag("exclude-copyleft");

function loadRecords(src: string): any[] {
  const st = statSync(src);
  if (st.isDirectory()) {
    return readdirSync(src).filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(src, f), "utf8")); } catch { return null; } })
      .filter(Boolean);
  }
  return readFileSync(src, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

async function fetchLine(sourceRef: string): Promise<string | null> {
  const p = parseSourceRef(sourceRef);
  if ("error" in p) return null;
  try {
    const res = await fetch(p.rawUrl);
    if (!res.ok) return null;
    const lines = (await res.text()).split("\n");
    if (p.line && lines[p.line - 1] != null) return lines[p.line - 1];
    return null; // no line anchor → can't pinpoint; validator will skip the fetched-line checks
  } catch { return null; }
}

const records = loadRecords(SOURCE).slice(0, LIMIT);
console.log(`export:cleanroom · source=${SOURCE} · in=${records.length} · tier=${TIER} · verify=${VERIFY} · exclude-copyleft=${EXCLUDE_COPYLEFT}`);

const kept: CleanroomRecord[] = [];
const dropped: { trapId: string; reason: string }[] = [];
const byClass: Record<string, number> = {};
const byTier: Record<string, number> = { "synthetic-owned": 0, wild: 0 };
let excludedCopyleft = 0;

for (const raw of records) {
  const { record, error, strippedEvidence } = toCleanroom(raw);
  if (error || !record) { dropped.push({ trapId: raw.trapId ?? raw.id ?? "?", reason: error ?? "transform failed" }); continue; }
  if (TIER !== "all" && record.provenance.class !== (TIER === "owned" ? "synthetic-owned" : "wild")) continue;

  // upstream-license (wild only)
  if (record.provenance.class === "wild" && (EXCLUDE_COPYLEFT || VERIFY) && record.provenance.sourceRef) {
    const lic = await detectUpstreamLicense(record.provenance.sourceRef);
    record.provenance.upstreamLicense = lic.spdx;
    if (EXCLUDE_COPYLEFT && (lic.bucket === "strong-copyleft")) { excludedCopyleft++; dropped.push({ trapId: record.trapId, reason: `excluded ${lic.spdx} (strong copyleft)` }); continue; }
  }

  // verify the pinned pointer (network)
  let fetchedLine: string | null | undefined;
  if (VERIFY && record.provenance.class === "wild" && record.provenance.sourceRef) {
    fetchedLine = await fetchLine(record.provenance.sourceRef);
  }

  const issues = validateCleanroom(record, strippedEvidence, { fetchedLine });
  if (issues.length) { dropped.push({ trapId: record.trapId, reason: issues.map((i) => i.code).join(",") }); continue; }

  kept.push(record);
  byClass[record.class] = (byClass[record.class] ?? 0) + 1;
  byTier[record.provenance.class]++;
}

mkdirSync(OUT, { recursive: true });
const ndjson = kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : "");
const outFile = join(OUT, `cleanroom.${TIER}.jsonl`);
writeFileSync(outFile, ndjson);

const manifest = {
  schema: "cleanroom-1.0",
  generatedAt: new Date().toISOString(),
  source: SOURCE,
  tier: TIER,
  license: "brainblast-training-1.0 (see datasets/marketplace/DATA-LICENSE.md)",
  count: kept.length,
  byTier,
  byClass,
  droppedCount: dropped.length,
  excludedCopyleft,
  sha256: createHash("sha256").update(ndjson).digest("hex"),
  file: `cleanroom.${TIER}.jsonl`,
  verifyProvenance: VERIFY,
  excludeCopyleft: EXCLUDE_COPYLEFT,
};
writeFileSync(join(OUT, "MANIFEST.json"), JSON.stringify(manifest, null, 2));

console.log(`\n  kept ${kept.length}  (owned ${byTier["synthetic-owned"]}, wild ${byTier.wild})`);
console.log(`  dropped ${dropped.length}${excludedCopyleft ? ` (incl ${excludedCopyleft} copyleft-excluded)` : ""}`);
if (dropped.length) for (const d of dropped.slice(0, 12)) console.log(`    - ${d.trapId}: ${d.reason}`);
console.log(`  → ${outFile}`);
console.log(`  → ${join(OUT, "MANIFEST.json")}`);
