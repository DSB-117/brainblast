// fleet — R7 of ROADMAP-TRAINING-DATA.md. The scout fleet's engine.
//
// A powerful, expandable, run-it-yourself loop for sourcing VTIs continuously:
//
//   discover candidates → PROVE RED→GREEN → auto-promote proven → intake → score
//
// Drop a candidate Finding in fleet/candidates/ and run `npm run fleet`. Every
// candidate is gated by the SAME RED→GREEN proof the corpus SLA enforces, so only
// real, reproducing traps ever land. Proven candidates are auto-promoted to
// packs/ (no manual `cp`), then the intake conveyor regenerates the corpus +
// storefront, and a scoreboard reports what landed, what drafted, the corpus
// delta, and the remaining coverage work-orders — i.e. exactly what to scout next.
//
//   npm run fleet                 prove → promote → intake → score
//   npm run fleet -- --dry-run    prove + score only (no promote, no intake)
//   npm run fleet -- --candidate fleet/candidates/<id>.json   one candidate
//
// Autonomy: the brainblast-scout skill produces candidates targeting the
// work-orders this scoreboard prints; this engine proves + lands them. The two
// together are the continuous fleet.

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { proveFinding, type Finding } from "../src/synth/index.ts";
import { CLASS_BY_RULE, classifyTrap } from "../src/vtiClass.ts";

const coreRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(coreRoot, "..", "..");
const candidatesDir = join(repoRoot, "fleet", "candidates");
const packsDir = join(repoRoot, "packs");
const stageRoot = join(coreRoot, ".synth");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const onlyIdx = argv.indexOf("--candidate");
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;

interface FleetRow {
  id: string;
  verdict: "PROMOTED" | "ALREADY" | "DRAFT";
  class?: string;
  sdk?: string;
  reason?: string;
  classWarning?: boolean;
  method?: string;
}

function discover(): string[] {
  if (only) return [only.startsWith("/") ? only : join(repoRoot, only)];
  if (!existsSync(candidatesDir)) return [];
  return readdirSync(candidatesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(candidatesDir, f));
}

// Promote a PROVEN candidate's staged rule + fixtures into a standalone pack.
function promote(f: Finding, staged: NonNullable<Awaited<ReturnType<typeof proveFinding>>["staged"]>): void {
  const dir = join(packsDir, f.id);
  mkdirSync(join(dir, "rules"), { recursive: true });
  mkdirSync(join(dir, "fixtures", f.id, "vulnerable"), { recursive: true });
  mkdirSync(join(dir, "fixtures", f.id, "fixed"), { recursive: true });
  cpSync(staged.ruleFile, join(dir, "rules", `${f.id}.yaml`));
  cpSync(staged.vulnerableDir, join(dir, "fixtures", f.id, "vulnerable"), { recursive: true });
  cpSync(staged.fixedDir, join(dir, "fixtures", f.id, "fixed"), { recursive: true });
  const name = f.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const manifest =
    `id: ${f.id}\n` +
    `name: ${JSON.stringify(name)}\n` +
    `version: 0.1.0\n` +
    `author: brainblast-fleet\n` +
    `description: ${JSON.stringify(f.title)}\n`;
  writeFileSync(join(dir, "brainblast-pack.yaml"), manifest);
}

const files = discover();
const rows: FleetRow[] = [];
console.log(`\nfleet — ${files.length} candidate(s) from ${only ? only : "fleet/candidates/"}\n`);

for (const file of files) {
  let f: Finding & { class?: string };
  try {
    f = JSON.parse(readFileSync(file, "utf8"));
  } catch (e: any) {
    rows.push({ id: basename(file), verdict: "DRAFT", reason: `malformed JSON: ${e?.message ?? e}` });
    continue;
  }
  const outcome = await proveFinding(f, stageRoot);
  const sdk = f.component?.name;
  if (outcome.verdict !== "PROVEN" || !outcome.staged) {
    console.log(`  ✗ ${f.id.padEnd(40)} DRAFT — ${outcome.reason}`);
    rows.push({ id: f.id, verdict: "DRAFT", reason: outcome.reason, sdk });
    continue;
  }
  const exists = existsSync(join(packsDir, f.id, "brainblast-pack.yaml"));
  // The class the corpus will assign (explicit map wins; else keyword heuristic).
  const declared = f.class;
  const effective = CLASS_BY_RULE[f.id] ?? classifyTrap({ id: f.id, title: f.title } as any);
  const classWarning = declared != null && declared !== effective;
  const via = outcome.method ? ` via ${outcome.method}` : "";
  if (!exists && !dryRun) {
    promote(f, outcome.staged);
    console.log(`  ✓ ${f.id.padEnd(40)} PROVEN${via} → promoted (class ${effective}${classWarning ? ` ⚠ declared ${declared}` : ""})`);
    rows.push({ id: f.id, verdict: "PROMOTED", class: effective, sdk, classWarning, method: outcome.method ?? undefined });
  } else {
    const tag = dryRun ? "PROVEN (dry-run)" : "PROVEN — already in packs/";
    console.log(`  ✓ ${f.id.padEnd(40)} ${tag}${via} (class ${effective}${classWarning ? ` ⚠ declared ${declared}` : ""})`);
    rows.push({ id: f.id, verdict: exists ? "ALREADY" : "PROMOTED", class: effective, sdk, classWarning, method: outcome.method ?? undefined });
  }
}

const promoted = rows.filter((r) => r.verdict === "PROMOTED");
const drafted = rows.filter((r) => r.verdict === "DRAFT");

// Run the intake conveyor only if something new landed.
let corpusBefore = countSeed();
if (!dryRun && promoted.length > 0) {
  console.log(`\nfleet: ${promoted.length} new pack(s) — running intake conveyor …\n`);
  await import("./gen-vti.ts");
  await import("./pack-dataset.ts");
  await import("./corpus-report.ts");
  await import("./catalog.ts");
}
const corpusAfter = countSeed();

writeReport(rows, corpusBefore, corpusAfter);
printScoreboard(rows, corpusBefore, corpusAfter);

function countSeed(): number {
  const p = join(repoRoot, "datasets", "seed", "seed-vti.jsonl");
  if (!existsSync(p)) return 0;
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length;
}

function workOrders(): string {
  const cov = join(repoRoot, "datasets", "COVERAGE.md");
  if (!existsSync(cov)) return "(run intake to refresh COVERAGE.md)";
  const md = readFileSync(cov, "utf8");
  const m = md.match(/## Scout work-orders[\s\S]*?(?=\n## |\n$)/);
  return m ? m[0].trim() : "(no work-orders section)";
}

function printScoreboard(rows: FleetRow[], before: number, after: number): void {
  console.log("\n────────────────────────  FLEET SCOREBOARD  ────────────────────────");
  console.log(`  candidates: ${rows.length}   promoted: ${promoted.length}   drafted: ${drafted.length}`);
  console.log(`  corpus: ${before} → ${after} VTIs (${after - before >= 0 ? "+" : ""}${after - before})`);
  if (drafted.length) {
    console.log("\n  drafted (not landed — fix the binding/fixtures and re-run):");
    for (const d of drafted) console.log(`    • ${d.id}: ${d.reason}`);
  }
  const warns = rows.filter((r) => r.classWarning);
  if (warns.length) {
    console.log("\n  ⚠ class drift (declared ≠ assigned — add to CLASS_BY_RULE in src/vtiClass.ts):");
    for (const w of warns) console.log(`    • ${w.id}: assigned ${w.class}`);
  }
  console.log("\n  next work-orders (where to scout next):");
  for (const line of workOrders().split("\n").slice(1)) console.log(`  ${line}`);
  console.log("\n  → fleet/REPORT.md\n");
}

function writeReport(rows: FleetRow[], before: number, after: number): void {
  const L: string[] = [];
  L.push("# Fleet report");
  L.push("");
  L.push(`_${new Date().toISOString()} · ${rows.length} candidate(s) · corpus ${before} → ${after} VTIs._`);
  L.push("");
  L.push("| Candidate | SDK | Verdict | Class | Notes |");
  L.push("|---|---|---|---|---|");
  for (const r of rows) {
    const notes = r.reason ?? (r.classWarning ? `⚠ declared class ≠ assigned ${r.class}` : "");
    L.push(`| ${r.id} | ${r.sdk ?? "—"} | ${r.verdict} | ${r.class ?? "—"} | ${notes} |`);
  }
  L.push("");
  L.push("## Next work-orders");
  L.push("");
  L.push(workOrders());
  L.push("");
  mkdirSync(join(repoRoot, "fleet"), { recursive: true });
  writeFileSync(join(repoRoot, "fleet", "REPORT.md"), L.join("\n"));
}
