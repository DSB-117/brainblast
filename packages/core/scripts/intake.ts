// intake — R1 of ROADMAP-TRAINING-DATA.md (the data-factory conveyor belt).
//
// North Star #2: producing a verified trap should be streamlined & automatic,
// and must NEVER block on spend. This one command takes a freshly-proven pack
// all the way into the sellable corpus AND the storefront:
//
//   [optional: validate the pack] → gen:vti → corpus → catalog
//
// so "trap found" → "in the catalog" with no manual glue and no `$BRAIN`.
// Staking (scout Phase 5) is an OPTIONAL bond layered on later — never required
// to produce or sell the data.
//
//   npm run intake                          regenerate corpus + catalog from all
//                                           bundled packs
//   npm run intake -- --pack packs/<id>     validate that pack first (fail-closed),
//                                           then run the conveyor
//
// Single source of truth: the existing gen-vti / corpus-report / catalog scripts
// are run in order via side-effect import. Each is fail-closed (exits non-zero on
// error), so a broken stage aborts the whole intake rather than shipping a
// half-built corpus.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack } from "../src/pack.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const seedPath = join(repoRoot, "datasets", "seed", "seed-vti.jsonl");

function trapCount(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim()).length;
}

const argv = process.argv.slice(2);
const packIdx = argv.indexOf("--pack");
const packDir = packIdx >= 0 ? argv[packIdx + 1] : undefined;

// ── Optional gate: prove the freshly-scouted pack before it touches the corpus ──
// This is the same RED→GREEN reproduction the $BRAIN slash would key off — run
// here for free, no stake required.
if (packIdx >= 0 && !packDir) {
  console.error("intake: --pack needs a directory, e.g. --pack packs/my-trap");
  process.exit(2);
}
if (packDir) {
  if (!existsSync(packDir)) {
    console.error(`intake: pack dir not found: ${packDir}`);
    process.exit(1);
  }
  console.log(`intake: validating ${packDir} …`);
  let res: ReturnType<typeof validatePack>;
  try {
    res = validatePack(packDir);
  } catch (e: any) {
    console.error(`intake: ${packDir} is not a valid pack (${e?.message ?? e}). Expected a dir with brainblast-pack.yaml.`);
    process.exit(1);
  }
  for (const r of res.ruleResults) {
    const mark =
      r.status === "ok" ? "✅" : r.status === "missing-fixtures" || r.status === "unverifiable" ? "⏭️ " : "❌";
    console.log(`  ${mark} ${r.ruleId.padEnd(38)} ${r.status}${r.detail ? `  — ${r.detail}` : ""}`);
  }
  if (!res.ok) {
    console.error("intake: pack failed RED→GREEN validation — NOT ingesting. Fix the pack and re-run.");
    process.exit(1);
  }
  console.log("intake: pack proven RED→GREEN ✅\n");
}

const before = trapCount(seedPath);

// ── The conveyor ───────────────────────────────────────────────────────────────
// gen:vti makes the seed lot; pack:dataset packages it into the SELLABLE
// versioned lots; corpus scores it; catalog builds the storefront. Keeping
// pack:dataset in the chain is what keeps the seed↔packaged drift gate (npm run
// sla) green — "trap found → sellable" means the packaged lot moved too.
console.log("intake: [1/4] gen:vti — regenerating seed VTIs from bundled packs …");
await import("./gen-vti.ts");
console.log("\nintake: [2/4] pack:dataset — repackaging the sellable lots …");
await import("./pack-dataset.ts");
console.log("\nintake: [3/4] corpus — scoring, dedup, coverage …");
await import("./corpus-report.ts");
console.log("intake: [4/4] catalog — rebuilding the storefront …");
await import("./catalog.ts");

const after = trapCount(seedPath);
const delta = after - before;

console.log(`\nintake: ✅ done. corpus ${before} → ${after} VTIs (${delta >= 0 ? "+" : ""}${delta}).`);
console.log("  → datasets/seed/seed-vti.jsonl · corpus-index.json · COVERAGE.md · catalog.json · CATALOG.md");
if (packDir && delta <= 0) {
  console.log(
    "  note: trap count didn't rise — the pack may already be in the corpus, or its rule isn't bundled in packs/ yet (intake reads packs/, like gen:vti).",
  );
}
