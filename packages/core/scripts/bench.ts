// bench — Stage 1, Step 3 of ROADMAP-TRAINING-DATA.md.
//
// The eval wedge: "does a model avoid silent SDK-integration traps on current
// APIs?" Each Verified Trap Instance becomes one eval item. The grading ORACLE
// is Brainblast's own static checker, run via auditWithRule over a candidate:
//
//   checker FAILs on the candidate  → the model SHIPPED the trap   → score 0
//   checker does NOT fail (RED-free) → the model AVOIDED the trap   → score 1
//
// This is the same RED/GREEN gate that proves the dataset, so the benchmark is
// reward-gradable and fully reproducible — no secret answer key. Anti-gaming
// comes from FRESHNESS (Stage 3), not oracle secrecy.
//
// Modes:
//   npm run bench                       # --self-test (default)
//   npm run bench -- --self-test        # vulnerable→0% avoided, fixed→100%
//   npm run bench -- --emit-tasks <dir> # write tasks.jsonl + starter stubs
//   npm run bench -- --submissions <dir> [--out <dir>]   # grade + scorecard

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { listBundledPacks } from "../src/bundledPacks.ts";
import { loadPack } from "../src/packs.ts";
import { validatePack } from "../src/pack.ts";
import { auditWithOracle } from "../src/oracle/index.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

interface EvalItem {
  trapId: string;
  rule: Rule;
  packDir: string;
  sdk: string;
  version: string | null;
  severity: string;
  docUrl: string | null;
}

// The eval set = every bundled trap that PROVES RED→GREEN (so the oracle is
// trustworthy for that item). This is exactly the set gen-vti emits VTIs for.
function loadEvalSet(): EvalItem[] {
  const items: EvalItem[] = [];
  for (const bundled of listBundledPacks()) {
    const { manifest, rules } = loadPack(bundled.dir);
    const okRules = new Set(
      validatePack(bundled.dir).ruleResults.filter((r) => r.status === "ok").map((r) => r.ruleId),
    );
    for (const rule of rules) {
      if (!okRules.has(rule.id)) continue;
      items.push({
        trapId: rule.id,
        rule,
        packDir: bundled.dir,
        sdk: rule.component.name,
        version: rule.component.version ?? null,
        severity: rule.severity,
        docUrl: rule.component.sourceUrl ?? null,
      });
    }
  }
  return items.sort((a, b) => a.trapId.localeCompare(b.trapId));
}

// Grade one candidate directory against one trap's rule, through the SAME
// generalized oracle (proveWithBest's per-verdict twin) that admits the trap
// into the eval set in the first place — a static-only grade would always
// score a compiler/behavioral-only trap (no static shape by design, e.g.
// stripe-paymentintents-moved) as falsely "avoided" regardless of the
// candidate. avoided === true on GREEN or UNKNOWN (matches the prove gate's
// definition of GREEN; a `cant_tell`/no-eligible-backend counts as avoided,
// same leniency the static-only path had).
async function gradeDir(dir: string, rule: Rule): Promise<{ avoided: boolean; detail: string }> {
  const verdict = await auditWithOracle(dir, rule, { oracle: "best" });
  return { avoided: verdict.color !== "RED", detail: verdict.detail };
}

interface Scored { trapId: string; sdk: string; severity: string; avoided: boolean; detail: string }

async function scorecard(items: EvalItem[], dirFor: (it: EvalItem) => string | null) {
  const scored: Scored[] = [];
  for (const it of items) {
    const dir = dirFor(it);
    if (!dir || !existsSync(dir)) {
      scored.push({ trapId: it.trapId, sdk: it.sdk, severity: it.severity, avoided: false, detail: "no submission for this trap (counts as shipped)" });
      continue;
    }
    const { avoided, detail } = await gradeDir(dir, it.rule);
    scored.push({ trapId: it.trapId, sdk: it.sdk, severity: it.severity, avoided, detail });
  }
  const total = scored.length;
  const passed = scored.filter((s) => s.avoided).length;
  return { total, passed, pct: total ? Math.round((passed / total) * 1000) / 10 : 0, scored };
}

function renderMd(title: string, sc: Awaited<ReturnType<typeof scorecard>>): string {
  const lines = [
    `# ${title}`,
    ``,
    `**Score: ${sc.passed}/${sc.total} traps avoided (${sc.pct}%)**`,
    ``,
    `| Trap | SDK | Severity | Result |`,
    `|---|---|---|---|`,
    ...sc.scored.map((s) => `| \`${s.trapId}\` | ${s.sdk} | ${s.severity} | ${s.avoided ? "✅ avoided" : "❌ shipped"} |`),
    ``,
  ];
  return lines.join("\n");
}

// ── Modes ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? "") : undefined;
}
// Resolve a user-supplied path: absolute paths are honored as-is; relative
// paths are taken relative to the repo root.
function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(repoRoot, p);
}

const items = loadEvalSet();
if (items.length === 0) {
  console.error("no proven traps found — is the repo built?");
  process.exit(1);
}

// --emit-tasks: write a public task manifest + starter stubs a model fills in.
if (argv.includes("--emit-tasks")) {
  const dir = resolvePath(flag("--emit-tasks") || "bench/tasks");
  mkdirSync(join(dir, "starters"), { recursive: true });
  const tasks = items.map((it) => {
    // Starter = imports + signature from the FIXED fixture, body elided.
    const fixedDir = join(it.packDir, "fixtures", it.trapId, "fixed");
    const file = existsSync(fixedDir) ? readdirSync(fixedDir)[0] : undefined;
    if (file) {
      // Starter = imports + the function signature ONLY. We deliberately drop
      // all comments and the body so the fix is never leaked into the task.
      const lines = readFileSync(join(fixedDir, file), "utf8").split("\n");
      const imports = lines.filter((l) => l.startsWith("import "));
      const sigIdx = lines.findIndex((l) => /export\s+(async\s+)?function/.test(l));
      const sig: string[] = [];
      for (let i = sigIdx; i >= 0 && i < lines.length; i++) {
        sig.push(lines[i]);
        if (/\{\s*$/.test(lines[i])) break;
      }
      const starter = [...imports, "", ...sig, "  // TODO: implement correctly using the SDK.", "}", ""].join("\n");
      const sdir = join(dir, "starters", it.trapId);
      mkdirSync(sdir, { recursive: true });
      writeFileSync(join(sdir, file), starter);
    }
    return {
      trapId: it.trapId,
      sdk: it.sdk,
      version: it.version,
      severity: it.severity,
      docUrl: it.docUrl,
      prompt: `Using ${it.sdk}${it.version ? ` (${it.version})` : ""}, complete the exported function in starters/${it.trapId}/ so it is correct for production use. Consult the official docs${it.docUrl ? ` (${it.docUrl})` : ""}. Submit your file at submissions/${it.trapId}/.`,
      submitTo: `submissions/${it.trapId}/`,
    };
  });
  writeFileSync(join(dir, "tasks.jsonl"), tasks.map((t) => JSON.stringify(t)).join("\n") + "\n");
  console.log(`\nEmitted ${tasks.length} tasks → ${join(dir, "tasks.jsonl")} (+ starters/)\n`);
  process.exit(0);
}

// --submissions: grade a directory of model outputs (submissions/<trapId>/<file>).
if (argv.includes("--submissions")) {
  const subRoot = resolvePath(flag("--submissions")!);
  const outRoot = resolvePath(flag("--out") || "bench/results");
  const sc = await scorecard(items, (it) => {
    const d = join(subRoot, it.trapId);
    return existsSync(d) && statSync(d).isDirectory() ? d : null;
  });
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(join(outRoot, "scorecard.json"), JSON.stringify(sc, null, 2) + "\n");
  writeFileSync(join(outRoot, "scorecard.md"), renderMd("Brainblast Trap Benchmark — Scorecard", sc));
  console.log(`\nGraded ${sc.total} traps: ${sc.passed} avoided (${sc.pct}%) → ${join(outRoot, "scorecard.md")}\n`);
  process.exit(sc.pct === 100 ? 0 : 1);
}

// Default: --self-test. Proves the oracle end to end with no model needed.
const vuln = await scorecard(items, (it) => join(it.packDir, "fixtures", it.trapId, "vulnerable"));
const fixed = await scorecard(items, (it) => join(it.packDir, "fixtures", it.trapId, "fixed"));

console.log(`\nBenchmark self-test — ${items.length} proven traps`);
console.log(`  vulnerable baseline: ${vuln.passed}/${vuln.total} avoided (${vuln.pct}%)  — expect 0%`);
console.log(`  fixed baseline:      ${fixed.passed}/${fixed.total} avoided (${fixed.pct}%)  — expect 100%`);

const ok = vuln.pct === 0 && fixed.pct === 100;
if (!ok) {
  console.error(`\n  ❌ oracle self-test FAILED`);
  for (const s of vuln.scored.filter((s) => s.avoided)) console.error(`     vulnerable not caught: ${s.trapId}`);
  for (const s of fixed.scored.filter((s) => !s.avoided)) console.error(`     fixed wrongly flagged: ${s.trapId}`);
  process.exit(1);
}
console.log(`  ✅ oracle verified: every trap caught on vulnerable, none on fixed\n`);
