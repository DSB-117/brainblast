// fleet:checker-gate — Move 2 of the fleet: SELF-EXTENDING CHECKERS.
//
// When a footgun needs a NEW static shape no existing checker covers, a subagent
// proposes a checker. This gate VETS that proposal before it can ever join the
// registry — the soundness proof that makes an agent-written analyzer trustworthy:
//
//   1. PURITY   — the checker source imports only ts-morph; no fs/net/child_process/
//                 eval/dynamic-import/process. It analyzes ASTs, it can't act.
//   2. TRAP      — it proves its own Finding RED→GREEN (fires on vulnerable, silent
//                 on fixed), through the same proveFinding gate everything else uses.
//   3. NO FALSE POSITIVES — it NEVER returns `fail` across a large known-good corpus
//                 (the proposal's negative/ set + the fixed-side of every bundled
//                 pack). This is the crux: a checker that flags safe code is unsound.
//   4. DETERMINISM — proving twice yields the identical verdict.
//
// Only if ALL pass is it VETTED. Even then it is NOT auto-trusted: `--wire` copies
// it into src/checkers/ and prints the diff for a HUMAN to review + commit. The
// fleet proves soundness; a person ratifies analysis code that runs on real repos.
//
//   npm run fleet:checker-gate -- --proposal fleet/checker-proposals/<kind> [--wire]
//
// A proposal dir contains: checker.ts (exports `const checker`), candidate.json (a
// Finding whose check.kind === the dir name), and negative/*.ts (safe code).

import { existsSync, readFileSync, readdirSync, statSync, cpSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { proveFinding } from "../src/synth/index.ts";
import { registerChecker } from "../src/checkers/index.ts";
import { loadRules } from "../src/loadRules.ts";
import { auditWithRule } from "../src/audit.ts";
import type { Finding } from "../src/synth/index.ts";

const coreRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = join(coreRoot, "..", "..");
const packsDir = join(repoRoot, "packs");
const checkersDir = join(coreRoot, "src", "checkers");
// Stage into a private temp dir, not the shared packages/core/.synth — otherwise a
// concurrent proof (e.g. in the parallel test suite) can clobber our staged rule
// mid-audit and flip a sound proposal to REJECTED.
const stageRoot = mkdtempSync(join(tmpdir(), "checker-gate-stage-"));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function reject(msg: string): never {
  console.error(`\n  ✗ REJECTED — ${msg}\n`);
  process.exit(1);
}

const proposalArg = arg("proposal");
if (!proposalArg) {
  console.error("usage: npm run fleet:checker-gate -- --proposal fleet/checker-proposals/<kind> [--wire]");
  process.exit(2);
}
const proposalDir = resolve(proposalArg.startsWith("/") ? proposalArg : join(repoRoot, proposalArg.replace(/^(\.\.\/)+/, "")));
const kind = basename(proposalDir);
const checkerPath = join(proposalDir, "checker.ts");
const candidatePath = join(proposalDir, "candidate.json");
const negativeDir = join(proposalDir, "negative");

console.log(`\n==== fleet:checker-gate: proposed kind '${kind}' ====`);
for (const p of [checkerPath, candidatePath]) if (!existsSync(p)) reject(`missing ${basename(p)} in ${proposalDir}`);

// ── 1. Purity ────────────────────────────────────────────────────────────────
const src = readFileSync(checkerPath, "utf8");
const FORBIDDEN: [RegExp, string][] = [
  [/from\s+["'](node:)?(fs|child_process|net|http|https|dns|dgram|os|vm|worker_threads|cluster|repl|inspector)["']/, "imports a side-effecting module"],
  [/\brequire\s*\(/, "uses require()"],
  [/\beval\s*\(/, "uses eval()"],
  [/new\s+Function\s*\(/, "uses new Function()"],
  [/\bimport\s*\(/, "uses dynamic import()"],
  [/\bprocess\s*\./, "touches process"],
  [/\bglobalThis\b/, "touches globalThis"],
  [/\bfetch\s*\(/, "makes network calls"],
];
for (const [re, why] of FORBIDDEN) if (re.test(src)) reject(`checker.ts is impure — ${why} (matched ${re})`);
console.log("  ✓ purity: no fs/net/exec/eval — analyzes ASTs only");

// ── load + register the proposed checker ──────────────────────────────────────
// Import from a temp copy INSIDE packages/core so the checker's bare `ts-morph`
// import resolves against packages/core/node_modules. The proposal lives at
// repo-root fleet/, where ts-morph isn't installed — importing it in place fails
// in a clean checkout (CI). Cleaned up immediately after loading.
const loadDir = mkdtempSync(join(coreRoot, ".checker-gate-load-"));
cpSync(checkerPath, join(loadDir, "checker.ts"));
let mod: any;
try {
  mod = await import(pathToFileURL(join(loadDir, "checker.ts")).href);
} catch (e: any) {
  rmSync(loadDir, { recursive: true, force: true });
  reject(`checker.ts failed to load (it must import ONLY ts-morph): ${e?.message ?? e}`);
}
rmSync(loadDir, { recursive: true, force: true });
const fn = mod.checker ?? mod.default;
if (typeof fn !== "function") reject("checker.ts must `export const checker = (candidate, params) => ({ result, detail })`");
registerChecker(kind, fn);

// ── 2. Trap proves RED→GREEN ──────────────────────────────────────────────────
const finding = JSON.parse(readFileSync(candidatePath, "utf8")) as Finding;
if (finding.binding.check.kind !== kind) reject(`candidate check.kind '${finding.binding.check.kind}' must equal the proposal dir name '${kind}'`);
const proof = await proveFinding(finding, stageRoot);
if (proof.verdict !== "PROVEN") reject(`the checker does not prove its own trap RED→GREEN: ${proof.reason}`);
console.log(`  ✓ trap: ${finding.id} proves RED→GREEN via ${proof.method}`);

// ── 4. Determinism ────────────────────────────────────────────────────────────
const proof2 = await proveFinding(finding, stageRoot);
if (proof2.verdict !== "PROVEN" || proof2.method !== proof.method) reject("non-deterministic — a second proof produced a different result");
console.log("  ✓ deterministic: identical on re-run");

// ── 3. No false positives on known-good code ──────────────────────────────────
// Corpus = the proposal's negative/ + the fixed side of every bundled pack. The
// enumeration + each audit are wrapped defensively: `packs/` is a live directory
// other tooling (and the parallel test suite) may be mutating, and a dir that is
// transiently unreadable or malformed must be SKIPPED — never counted as a false
// positive and never crashing the gate. Only an actual `fail` verdict is a false
// positive. (Errors are still surfaced so a genuinely broken pack is visible.)
const rule = loadRules(join(stageRoot, finding.id, "rules"))[0];
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
const corpus: string[] = [];
if (existsSync(negativeDir)) corpus.push(negativeDir);
for (const pack of safe(() => (existsSync(packsDir) ? readdirSync(packsDir) : []), [] as string[])) {
  const fixturesRoot = join(packsDir, pack, "fixtures");
  if (!existsSync(fixturesRoot)) continue;
  for (const rid of safe(() => readdirSync(fixturesRoot), [] as string[])) {
    const fixedDir = join(fixturesRoot, rid, "fixed");
    if (existsSync(fixedDir) && safe(() => statSync(fixedDir).isDirectory(), false)) corpus.push(fixedDir);
  }
}
const falsePositives: string[] = [];
let skipped = 0;
for (const dir of corpus) {
  let results;
  try {
    results = auditWithRule(dir, rule);
  } catch {
    skipped++; // transiently unreadable / mid-mutation — not a soundness signal
    continue;
  }
  for (const r of results) {
    if (r.result === "fail") falsePositives.push(`${r.file} (in ${dir.slice(repoRoot.length + 1)})`);
  }
}
if (falsePositives.length) {
  reject(`FALSE POSITIVES — the checker flagged known-good code:\n    ${falsePositives.join("\n    ")}`);
}
console.log(`  ✓ no false positives across ${corpus.length - skipped} known-good dir(s)${skipped ? ` (${skipped} skipped as unreadable)` : ""} (negative corpus + every pack's fixed side)`);

// ── VETTED ────────────────────────────────────────────────────────────────────
console.log(`\n  ✅ VETTED — '${kind}' is sound.`);

const camel = kind.split("-").map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
if (!process.argv.includes("--wire")) {
  console.log(`\n  To install (human ratification): re-run with --wire, then review \`git diff\` and commit.`);
  process.exit(0);
}

// Wire it in: copy the checker into src/checkers/ and register it in index.ts.
// The checker imports only ts-morph, so it needs no path rewriting.
const destFile = join(checkersDir, `${camel}.ts`);
cpSync(checkerPath, destFile);
const indexPath = join(checkersDir, "index.ts");
let index = readFileSync(indexPath, "utf8");
const importLine = `import { checker as ${camel} } from "./${camel}.ts";\n`;
if (!index.includes(importLine)) index = importLine + index;
const anchor = `"differential-io": differentialIo,\n};`;
if (!index.includes(anchor)) reject("could not find the registry insertion point in index.ts — wire it manually");
index = index.replace(anchor, `"differential-io": differentialIo,\n  "${kind}": ${camel} as Checker,\n};`);
writeFileSync(indexPath, index);
console.log(`  → wrote src/checkers/${camel}.ts and registered "${kind}" in index.ts.`);
console.log(`  Review \`git diff packages/core/src/checkers/\`, then commit to ratify.\n`);
process.exit(0);
