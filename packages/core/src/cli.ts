#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.ts";
import { getChangedRanges } from "./gitDiff.ts";
import { loadMemory, saveMemory, updateMemory, precedentKey } from "./memory.ts";
import { resolveRules } from "./resolveRules.ts";
import { buildTrustGraph, renderTrustGraphMd, isValidSolanaAddress, cacheSize, loadProgramCache, defaultCachePath } from "./trustGraph/index.ts";
import { analyzeCosts, renderCostReportMd } from "./costAnalysis.ts";
import { analyzeWallet, renderWalletSection } from "./wallet/analyze.ts";
import { buildDeployPlan, renderDeployPlanMd, renderDeployPlanText } from "./deployPlan.ts";
import {
  EXPLOIT_PATTERNS,
  getExploitPattern,
  renderExploitsText,
  renderExploitsMd,
  renderExploitDetailText,
} from "./exploitPatterns.ts";
import { startWatch } from "./watch.ts";
import { execFileSync } from "node:child_process";
import { applyDiffToFile, parseDiff } from "./fixers/applyDiff.ts";
import { initPack, validatePack } from "./pack.ts";
import { listBundledPacks, resolveBundledPackToken } from "./bundledPacks.ts";
import { isTelemetryEnabled, recordGraduationEvents, telemetryFilePath, submitTelemetry } from "./telemetry.ts";

// Usage:
//   brainblast <targetDir> [--ci] [--strict] [--since <ref>]
//   brainblast diff <pkg>@<from> <pkg>@<to> [--ecosystem <eco>] [--json]
//   brainblast drift [targetDir] [--update-baseline] [--json]
//   brainblast mcp
//   brainblast watch [targetDir]
//   brainblast trust-graph <programId> [<programId>...] [--rpc URL] [--no-probe] [--json]
//
// `audit` runs every bundled rule (default). With --ci, a confirmed FAIL exits
// 1. CANT_TELL warns and does NOT fail unless --strict is passed.
//
// `--since <ref>` enables diff-aware scanning: only functions (TS/Rust) whose
// line range overlaps a change in `git diff <ref>`, and config/env files that
// changed at all, are audited. Pairs naturally with CI ("--since origin/main")
// or a pre-commit/save hook ("--since HEAD").
//
// `watch` runs as a daemon: on every file save, it re-scans only the working-
// tree changes (vs HEAD, including untracked files) and emits one NDJSON
// event per line on stdout (`finding` / `scan_complete` / `scan_error` /
// `watch_started`) — for an agent daemon to tail directly, no report.json
// polling needed.
//
// `fix [targetDir] [--apply]` lists every confirmed FAIL that ships a
// mechanical `fix.diff` (RED). Without `--apply` it's a dry run (prints what
// would change). With `--apply`, it writes each diff to disk, then re-audits
// to confirm those findings now pass or cant_tell (GREEN) and reports any
// that didn't take. Pass `--branch` to also create a new git branch and
// commit the changes (`brainblast/auto-fix-<timestamp>`).
//
// `trust-graph` resolves upgrade authority + verified-build status for each
// program id (Phase 1 of PLAN-solana-deep-dive.md). Reads the bundled program
// directory first, then the program cache (~/.brainblast/program-cache.json),
// and falls back to a live RPC probe for anything unknown. Pass --no-cache to
// skip the cache entirely (always re-probe from RPC).
//
// `--packs <dir1>,<dir2>,...` loads additional pluggable rule packs from the
// given directories (each must contain a brainblast-pack.yaml manifest plus
// a rules/ directory), on top of bundled rules, project-local
// .agent-research/rules/, and any packs auto-discovered under
// .agent-research/packs/. Works with both the main audit command and `fix`.
//
// `pack init <dir> --id <pack-id> [--name <name>] [--author <author>]
// [--version <semver>] [--description <text>]` scaffolds a new rule pack:
// brainblast-pack.yaml, rules/, fixtures/.
//
// `pack validate <dir>` loads the pack's manifest + rules (failing on any
// malformed manifest/rule) and runs the prove gate: for each rule with a
// fixtures/<rule-id>/{vulnerable,fixed}/ pair, the rule must FAIL against
// vulnerable/ and must NOT FAIL against fixed/ (RED -> GREEN). Rules with no
// fixtures are reported as a warning, not a hard failure. Exits 1 if any
// rule fails its prove gate or the manifest/rules don't load.
//
// `telemetry submit [targetDir]` is an explicit, opt-in step that POSTs the
// local .agent-research/telemetry.ndjson (graduation events recorded by
// `fix --apply` when telemetry is enabled, see src/telemetry.ts) to the
// registry at BRAINBLAST_REGISTRY_URL (default https://registry.brainblast.tech).
// Reports each (pack_id, rule_id)'s graduation progress (5 distinct
// repo/user pairs within 90 days graduates a rule).
const args = process.argv.slice(2);

function parsePackDirs(argv: string[]): string[] {
  const idx = argv.indexOf("--packs");
  if (idx < 0) return [];
  const value = argv[idx + 1];
  if (!value || value.startsWith("--")) return [];
  const tokens = value.split(",").map((s) => s.trim()).filter(Boolean);
  // Each token is either an explicit pack directory or a bundled protocol name
  // ("jupiter", "pyth"). Resolve names to bundled pack dirs so users name the
  // protocols in their stack, not filesystem paths.
  return tokens.map((t) => {
    if (existsSync(join(t, "brainblast-pack.yaml"))) return t; // explicit path
    const resolved = resolveBundledPackToken(t);
    if (resolved) return resolved;
    console.error(
      `brainblast: --packs '${t}' is not a known bundled pack or a pack directory. ` +
        `Run 'brainblast packs' to list bundled packs.`,
    );
    process.exit(2);
  });
}

if (args[0] === "diff") {
  await runDiff(args.slice(1));
  process.exit(0);
}

if (args[0] === "drift") {
  await runDrift(args.slice(1));
  process.exit(0);
}

if (args[0] === "mcp") {
  const { startMcpServer } = await import("./mcp.ts");
  await startMcpServer();
  process.exit(0);
}

if (args[0] === "trust-graph") {
  await runTrustGraph(args.slice(1));
  process.exit(0);
}

if (args[0] === "pack") {
  await runPack(args.slice(1));
  process.exit(0);
}

if (args[0] === "verify") {
  await runVerify(args.slice(1));
  process.exit(0);
}

if (args[0] === "packs") {
  runPacks(args.slice(1));
  process.exit(0);
}

if (args[0] === "telemetry") {
  await runTelemetry(args.slice(1));
  process.exit(0);
}

if (args[0] === "watch") {
  const watchDir = args.find((a, i) => i > 0 && !a.startsWith("--")) ?? process.cwd();
  startWatch(watchDir);
  // Keep the process alive; Ctrl-C / SIGTERM exits cleanly.
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  await new Promise(() => {});
}

if (args[0] === "watch-chain") {
  const rest = args.slice(1);
  const programId = rest.find((a) => !a.startsWith("--"));
  if (!programId) {
    console.error("usage: brainblast watch-chain <program-id> [--rpc URL] [--interval <seconds>] [--limit N]");
    console.error("  Poll a deployed program for new activity and upgrade-authority changes. Emits NDJSON.");
    process.exit(2);
  }
  const { startChainWatch } = await import("./watchChain.ts");
  const rpcIdx = rest.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? rest[rpcIdx + 1] : undefined;
  const intIdx = rest.indexOf("--interval");
  const intervalMs = intIdx >= 0 ? parseInt(rest[intIdx + 1], 10) * 1000 : undefined;
  const limIdx = rest.indexOf("--limit");
  const limit = limIdx >= 0 ? parseInt(rest[limIdx + 1], 10) : undefined;
  const handle = startChainWatch(programId, { rpcUrl, intervalMs, limit });
  process.on("SIGINT", () => { handle.stop(); process.exit(0); });
  process.on("SIGTERM", () => { handle.stop(); process.exit(0); });
  await new Promise(() => {});
}

if (args[0] === "rico") {
  await runRico(args.slice(1));
  process.exit(0);
}

if (args[0] === "firewall") {
  await runFirewall(args.slice(1));
  process.exit(0);
}

if (args[0] === "idl-rules") {
  await runIdlRules(args.slice(1));
  process.exit(0);
}

if (args[0] === "score") {
  await runScore(args.slice(1));
  process.exit(0);
}

if (args[0] === "pump-check") {
  await runPumpCheck(args.slice(1));
  process.exit(0);
}

if (args[0] === "batch") {
  await runBatch(args.slice(1));
  process.exit(0);
}

if (args[0] === "deploy-plan") {
  runDeployPlan(args.slice(1));
  process.exit(0);
}

if (args[0] === "exploits") {
  runExploits(args.slice(1));
  process.exit(0);
}

if (args[0] === "oracle") {
  await runOracle(args.slice(1));
  process.exit(0);
}

if (args[0] === "fee-configs") {
  await runFeeConfigs(args.slice(1));
  process.exit(0);
}

if (args[0] === "keys") {
  await runKeys(args.slice(1));
  process.exit(0);
}

if (args[0] === "vault") {
  await runVault(args.slice(1));
  process.exit(0);
}

if (args[0] === "guard") {
  await runGuard(args.slice(1));
  process.exit(0);
}

if (args[0] === "rescue") {
  await runRescue(args.slice(1));
  process.exit(0);
}

if (args[0] === "signguard") {
  await runSignguard(args.slice(1));
  process.exit(0);
}

if (args[0] === "wallet-check") {
  await runWalletCheck(args.slice(1));
  process.exit(0);
}

if (args[0] === "fix") {
  await runFix(args.slice(1));
  process.exit(0);
}

const ci = args.includes("--ci");
const strict = args.includes("--strict");
const failOnWallet = args.includes("--fail-on-wallet");
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;
// Accept both `--oracle <v>` and `--oracle=<v>`.
function flagValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const oracleArg = flagValue(args, "oracle");
const targetDir =
  args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--since" && args[i - 1] !== "--oracle") ?? process.cwd();

if (sinceIdx >= 0 && !since) {
  console.error("error: --since requires a <ref> argument, e.g. --since origin/main");
  process.exit(2);
}

const rules = resolveRules(targetDir, parsePackDirs(args));
let changedRanges;
if (since) {
  try {
    changedRanges = getChangedRanges(targetDir, since);
  } catch (e: any) {
    console.error(e.message ?? String(e));
    process.exit(2);
  }
}
const { checks, report } = audit(targetDir, rules, changedRanges);

// Living memory: detect fixes since the last run, and surface precedents for
// current fails (same rule already fixed elsewhere in this repo). Skipped in
// `--since` mode: a diff-scoped run only sees a subset of checks, and writing
// that partial snapshot back would make the next full run re-derive fix
// events it already has.
if (!changedRanges) {
  const memory = loadMemory(targetDir);
  const { memory: nextMemory, precedents } = updateMemory(memory, checks);
  for (const c of checks) {
    const p = precedents.get(precedentKey(c));
    if (p) c.precedent = p;
  }
  for (const rc of report.checks as Array<{ ruleId: string; file: string; precedent?: unknown }>) {
    const p = precedents.get(precedentKey(rc as { ruleId: string; file: string }));
    if (p) rc.precedent = p;
  }
  saveMemory(targetDir, nextMemory);
} else {
  // Still surface precedents (read-only) against the existing snapshot.
  const memory = loadMemory(targetDir);
  const { precedents } = updateMemory(memory, checks);
  for (const c of checks) {
    const p = precedents.get(precedentKey(c));
    if (p) c.precedent = p;
  }
  for (const rc of report.checks as Array<{ ruleId: string; file: string; precedent?: unknown }>) {
    const p = precedents.get(precedentKey(rc as { ruleId: string; file: string }));
    if (p) rc.precedent = p;
  }
}

const costReport = analyzeCosts(targetDir);
// Attach cost analysis as a named section — additive, never mutates security results.
(report as any).costAnalysis = costReport;

// Wallet Guard (v0.8.3): reconcile declared network (.env) vs wallet-adapter
// wiring. Attached as an additive section like costAnalysis — surfaced on every
// full run, but kept OUT of checks[]/checkTotals so it never changes the security
// verdict or an existing CI gate. Skipped in --since mode (it's whole-repo /
// cross-file, like the memory write). Gate it explicitly with --fail-on-wallet.
let walletReport: ReturnType<typeof analyzeWallet> | undefined;
if (!changedRanges) {
  walletReport = analyzeWallet(targetDir);
  (report as any).walletConfig = walletReport;
}

const outDir = join(targetDir, ".agent-research");
mkdirSync(outDir, { recursive: true });

const reportPath = join(outDir, "report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

const costMdPath = join(outDir, "cost-analysis.md");
writeFileSync(costMdPath, renderCostReportMd(costReport));

console.log(`brainblast: scanned ${targetDir} with ${rules.length} rule(s)`);
if (checks.length === 0) console.log("  (no catastrophic components detected)");
for (const c of checks) {
  const tag = c.result === "pass" ? "PASS " : c.result === "fail" ? "FAIL " : "WARN ";
  console.log(`  [${tag}] ${c.ruleId}  ${c.file}:${c.line}`);
  console.log(`          ${c.detail}`);
  if (c.precedent) {
    console.log(
      `          memory: same issue (${c.ruleId}) was fixed in ${c.precedent.file} on ${c.precedent.fixedAt}`,
    );
  }
  if (c.fix) {
    console.log(`          fix: ${c.fix.summary}`);
    if (c.fix.diff) {
      for (const line of c.fix.diff.split("\n")) console.log(`            ${line}`);
    }
    if (c.fix.suggestion) {
      for (const line of c.fix.suggestion.split("\n")) console.log(`            ${line}`);
    }
  }
}
const fails = checks.filter((c) => c.result === "fail").length;
const cantTell = checks.filter((c) => c.result === "cant_tell").length;
console.log(`  verdict: ${report.summary.verdict}  (fail=${fails}, cant_tell=${cantTell})`);
if (cantTell > 0 && !strict) {
  console.log(`  warning: ${cantTell} cant_tell (not gating — pass --strict to fail on these)`);
}

// Cost & rent summary
console.log("\n── Cost & Rent ──────────────────────────────────────────────");
if (!costReport.priorityFee.found) {
  console.log("  [HIGH ] priority fee not configured — add setComputeUnitPrice to critical paths");
}
if (costReport.accountFlows.length === 0) {
  console.log("  (no account-creation flows from tracked modules detected)");
} else {
  for (const f of costReport.accountFlows) {
    const file = f.file.split("/").slice(-2).join("/");
    const scaleMark = f.scalable ? " [SCALABLE]" : "";
    console.log(`  ${f.accountType}${scaleMark}  ${file}:${f.line}  +${f.lamports.toLocaleString()} lamports (${f.sol} SOL)`);
  }
  if (costReport.totalLockupLamports > 0) {
    console.log(`  ─── static lockup total: ${costReport.totalLockupLamports.toLocaleString()} lamports (~${costReport.totalLockupSol} SOL)`);
  }
}
console.log(`  cost report: ${costMdPath}`);
console.log(`  report:      ${reportPath}`);

// Wallet config section — additive/advisory; only shown when relevant.
if (walletReport && (walletReport.walletAdapterDetected || walletReport.findings.length > 0)) {
  console.log("\n" + renderWalletSection(walletReport));
}

// Oracle backends (v0.9.0) — additive, advisory. The default (`--oracle=static`
// or omitted) leaves this whole block untouched, so the offline cost path is
// byte-for-byte what it was in 0.8.3. When `--oracle=compiler|best` is passed,
// any in-scope rule a higher-tier backend can decide (e.g. a `compiles-against-
// sdk` rule) is verified against the target and reported — never folded into the
// security verdict or the CI gate.
if (oracleArg && oracleArg !== "static" && oracleArg !== "static-checker") {
  const { parseOracleSelector, selectBackends } = await import("./oracle/index.ts");
  let selection;
  try {
    selection = selectBackends(parseOracleSelector(oracleArg));
  } catch (e: any) {
    console.error(`error: ${e.message ?? e}`);
    process.exit(2);
  }
  // Only the non-static backends add information here; static is already the
  // primary scan above.
  const extra = selection.backends.filter((b) => b.tier > 0);
  const lines: string[] = [];
  for (const rule of rules) {
    for (const backend of extra) {
      if (!backend.supports(rule)) continue;
      const v = await backend.verify({ dir: targetDir, rule, context: "local" });
      const tag = v.color === "RED" ? "RED " : v.color === "GREEN" ? "GREEN" : "UNK  ";
      lines.push(`  [${tag}] ${rule.id} (${v.method})`);
      lines.push(`          ${v.detail}`);
    }
  }
  console.log(`\n── Oracle (${oracleArg}) ────────────────────────────────────────`);
  if (lines.length === 0) {
    console.log("  (no in-scope rule is decidable by a non-static backend)");
  } else {
    for (const l of lines) console.log(l);
  }
}

// Opt-in wallet gating: fails only when --fail-on-wallet is passed AND a
// critical/high wallet finding exists. The default verdict/exit is unchanged.
const walletGate =
  failOnWallet && !!walletReport && walletReport.findings.some((f) => f.severity === "critical" || f.severity === "high");

if (ci) {
  const gateFail = fails > 0 || (strict && cantTell > 0) || walletGate;
  process.exit(gateFail ? 1 : 0);
}
if (walletGate) process.exit(1);

function runDeployPlan(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: brainblast deploy-plan [targetDir] [--json] [--max-len-mult N] [--program-len BYTES] [--priority-fee MICROLAMPORTS]");
    console.log("  Estimate SOL needed to deploy an Anchor program and print the exact ordered");
    console.log("  transaction sequence (create buffer → write → deploy → initialize PDAs).");
    console.log("  Reads the compiled .so under target/deploy/; pass --program-len to model a");
    console.log("  build you haven't compiled yet.");
    process.exit(0);
  }
  const num = (name: string): number | undefined => {
    const idx = argv.indexOf(`--${name}`);
    if (idx < 0) return undefined;
    const v = parseInt(argv[idx + 1], 10);
    return Number.isFinite(v) ? v : undefined;
  };
  const targetDir =
    argv.find((a, i) => !a.startsWith("--") && !/^\d+$/.test(a) && argv[i - 1] !== "--max-len-mult" && argv[i - 1] !== "--program-len" && argv[i - 1] !== "--priority-fee") ??
    process.cwd();

  const plan = buildDeployPlan(targetDir, {
    maxLenMultiplier: num("max-len-mult"),
    programLen: num("program-len"),
    priorityMicroLamports: num("priority-fee"),
  });

  if (argv.includes("--json")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(renderDeployPlanText(plan));

  const outDir = join(targetDir, ".agent-research");
  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, "deploy-plan.md");
  writeFileSync(mdPath, renderDeployPlanMd(plan));
  console.log(`  deploy plan: ${mdPath}`);
}

async function runFeeConfigs(argv: string[]) {
  const {
    FEE_CONFIGS,
    getFeeConfig,
    renderFeeConfigsText,
    renderFeeConfigsMd,
    renderFeeConfigDetailText,
  } = await import("./feeConfigs.ts");

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: brainblast fee-configs [id] [--json]");
    console.log("  Fee Config Validator: the silent zero-revenue class (fees, royalties,");
    console.log("  rewards) — fields that default to zero and quietly collect nothing. Pass an");
    console.log("  id to see one in detail. Known ids:");
    console.log(`    ${FEE_CONFIGS.map((e: any) => e.id).join(", ")}`);
    process.exit(0);
  }
  const json = argv.includes("--json");
  const id = argv.find((a) => !a.startsWith("--"));

  if (id) {
    const e = getFeeConfig(id);
    if (!e) {
      console.error(`error: no fee-config '${id}'. Known: ${FEE_CONFIGS.map((x: any) => x.id).join(", ")}`);
      process.exit(2);
    }
    if (json) console.log(JSON.stringify(e, null, 2));
    else console.log(renderFeeConfigDetailText(e));
    return;
  }

  if (json) {
    console.log(JSON.stringify(FEE_CONFIGS, null, 2));
    return;
  }
  console.log(renderFeeConfigsText());

  const outDir = join(process.cwd(), ".agent-research");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "fee-configs.md"), renderFeeConfigsMd());
  console.log(`\n  catalog: ${join(outDir, "fee-configs.md")}`);
}

async function runOracle(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h") || argv.filter((a) => !a.startsWith("--")).length === 0) {
    console.log("usage: brainblast oracle <account> [--rpc URL] [--max-staleness-slots N | --max-staleness-seconds N] [--json]");
    console.log("  Is the oracle fresh? Reports how many slots/seconds ago the price account was");
    console.log("  last written (provider-agnostic) and gates FRESH/STALE. Exit 1 on STALE or");
    console.log("  NO_HISTORY. Pass your own --rpc for reliable results (public RPC is rate-limited).");
    process.exit(argv.length === 0 ? 2 : 0);
  }
  const { checkOracleFreshness, renderOracleText, renderOracleMd } = await import("./oracle.ts");
  const num = (name: string): number | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = parseInt(argv[i + 1], 10);
    return Number.isFinite(v) ? v : undefined;
  };
  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : undefined;
  const account = argv.find(
    (a, i) => !a.startsWith("--") && argv[i - 1] !== "--rpc" && argv[i - 1] !== "--max-staleness-slots" && argv[i - 1] !== "--max-staleness-seconds",
  );
  if (!account) {
    console.error("error: missing <account>. usage: brainblast oracle <account> [--rpc URL] [--json]");
    process.exit(2);
  }

  let f;
  try {
    f = await checkOracleFreshness(account, {
      rpcUrl,
      maxStalenessSlots: num("max-staleness-slots"),
      maxStalenessSeconds: num("max-staleness-seconds"),
    });
  } catch (e: any) {
    console.error(`error: ${e?.message ?? String(e)}`);
    process.exit(2);
  }

  if (argv.includes("--json")) console.log(JSON.stringify(f, null, 2));
  else console.log(renderOracleText(f));

  const outDir = join(process.cwd(), ".agent-research");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "oracle-freshness.md"), renderOracleMd(f));

  process.exit(f.fresh ? 0 : 1);
}

function runExploits(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: brainblast exploits [id] [--json]");
    console.log("  The Exploit Pattern Database: real on-chain incidents mapped to the bundled");
    console.log("  rule that statically detects each root-cause pattern. Pass an incident id or");
    console.log("  rule id to see one in detail. Known ids:");
    console.log(`    ${EXPLOIT_PATTERNS.map((e) => e.id).join(", ")}`);
    process.exit(0);
  }
  const json = argv.includes("--json");
  const id = argv.find((a) => !a.startsWith("--"));

  if (id) {
    const e = getExploitPattern(id);
    if (!e) {
      console.error(`error: no exploit pattern '${id}'. Known: ${EXPLOIT_PATTERNS.map((x) => x.id).join(", ")}`);
      process.exit(2);
    }
    if (json) console.log(JSON.stringify(e, null, 2));
    else console.log(renderExploitDetailText(e));
    return;
  }

  if (json) {
    console.log(JSON.stringify(EXPLOIT_PATTERNS, null, 2));
    return;
  }
  console.log(renderExploitsText());

  const outDir = join(process.cwd(), ".agent-research");
  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, "exploit-patterns.md");
  writeFileSync(mdPath, renderExploitsMd());
  console.log(`\n  database: ${mdPath}`);
}

function runPacks(argv: string[]) {
  const packs = listBundledPacks();
  if (argv.includes("--json")) {
    console.log(JSON.stringify(packs.map((p) => ({ ...p.manifest, dir: p.dir })), null, 2));
    return;
  }
  if (packs.length === 0) {
    console.log("No bundled protocol packs found.");
    return;
  }
  console.log("Protocol Pack Library — opt into the exact stack you build on:\n");
  console.log("  brainblast --packs <name>[,<name>...] .\n");
  for (const p of packs) {
    // shortest unique name: the leading segment (protocol) when it resolves.
    const lead = p.id.split("-")[0];
    const shortName = resolveBundledPackToken(lead) === p.dir ? lead : p.id;
    console.log(`  ${shortName.padEnd(12)} ${p.manifest.name}`);
    if (p.manifest.description) console.log(`  ${" ".repeat(12)} ${p.manifest.description}`);
    console.log("");
  }
  console.log(`${packs.length} pack(s). Each ships RED→GREEN fixtures; run 'brainblast pack validate <dir>' to verify.`);
}

async function runPack(argv: string[]) {
  const sub = argv[0];

  if (sub === "init") {
    const dir = argv.find((a, i) => i > 0 && !a.startsWith("--") && argv[i - 1] !== "--id" && argv[i - 1] !== "--name" && argv[i - 1] !== "--author" && argv[i - 1] !== "--version" && argv[i - 1] !== "--description");
    const flag = (name: string) => {
      const idx = argv.indexOf(`--${name}`);
      return idx >= 0 ? argv[idx + 1] : undefined;
    };
    const id = flag("id");
    if (!dir || !id) {
      console.error("usage: brainblast pack init <dir> --id <pack-id> [--name <name>] [--author <author>] [--version <semver>] [--description <text>]");
      process.exit(2);
    }
    const manifestFile = initPack(dir, {
      id,
      name: flag("name"),
      author: flag("author"),
      version: flag("version"),
      description: flag("description"),
    });
    console.log(`brainblast pack init: wrote ${manifestFile}`);
    console.log(`  rules:    ${join(dir, "rules")}/`);
    console.log(`  fixtures: ${join(dir, "fixtures")}/`);
    return;
  }

  if (sub === "validate") {
    const dir = argv.find((a, i) => i > 0 && !a.startsWith("--"));
    if (!dir) {
      console.error("usage: brainblast pack validate <dir>");
      process.exit(2);
    }
    const result = await validatePack(dir);
    console.log(`pack: ${result.manifest.id} v${result.manifest.version} (${result.manifest.author})`);
    console.log(`  ${result.rules.length} rule(s)`);
    for (const r of result.ruleResults) {
      const marker =
        r.status === "ok"
          ? "OK"
          : r.status === "missing-fixtures" || r.status === "unverifiable"
            ? "WARN"
            : "FAIL";
      const via = r.method ? ` (${r.method})` : "";
      console.log(`  [${marker}] ${r.ruleId}${via}: ${r.detail}`);
    }
    process.exit(result.ok ? 0 : 1);
  }

  console.error("usage: brainblast pack <init|validate> ...");
  process.exit(2);
}

// `brainblast verify <pack-dir> [--oracle=static|compiler|best]` — re-prove a
// pack's records RED→GREEN with the backend each one needs, and print a
// reproduction-rate scorecard. This is the reproducibility-receipt tool a BUYER
// runs to check reward-gradability themselves: no trust in us required, they
// re-run the oracle and get the same colors. Exit 1 if any record fails to
// reproduce.
async function runVerify(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h") || argv.filter((a) => !a.startsWith("--")).length === 0) {
    console.log("usage: brainblast verify <pack-dir> [--oracle=static|compiler|best] [--json]");
    console.log("  Re-prove every record in a pack RED→GREEN through the oracle and print a");
    console.log("  reproduction scorecard. Each record's claimed proof method is re-run; a record");
    console.log("  that won't reproduce is reported (and exits 1). The offline Tier-0/1 backends");
    console.log("  (static, compiler) run by default; Tier-2 (executed/differential) need");
    console.log("  BRAINBLAST_ORACLE_EXEC=1 and land fully in v0.9.1.");
    process.exit(argv.length === 0 ? 2 : 0);
  }
  const { selectBackends, parseOracleSelector } = await import("./oracle/index.ts");
  const { proveWithBest, proofMethod } = await import("./oracle/prove.ts");
  const { loadPack } = await import("./packs.ts");
  const { existsSync } = await import("node:fs");

  const dir = argv.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("usage: brainblast verify <pack-dir> [--oracle=...] [--json]");
    process.exit(2);
  }
  const eqOracle = argv.find((a) => a.startsWith("--oracle="));
  const oIdx = argv.indexOf("--oracle");
  const oracleArg = eqOracle ? eqOracle.slice("--oracle=".length) : oIdx >= 0 ? argv[oIdx + 1] : "best";
  const jsonOut = argv.includes("--json");

  let selector;
  try {
    selector = parseOracleSelector(oracleArg);
  } catch (e: any) {
    console.error(`brainblast verify: ${e.message ?? e}`);
    process.exit(2);
  }
  const { backends } = selectBackends(selector);

  let pack;
  try {
    pack = loadPack(dir);
  } catch (e: any) {
    console.error(`brainblast verify: ${e.message ?? e}`);
    process.exit(2);
  }

  const rows: Array<{ ruleId: string; reproduced: boolean; method: string | null; detail: string }> = [];
  for (const rule of pack.rules) {
    const base = join(dir, "fixtures", rule.id);
    const vulnerableDir = join(base, "vulnerable");
    const fixedDir = join(base, "fixed");
    if (!existsSync(vulnerableDir) || !existsSync(fixedDir)) {
      rows.push({ ruleId: rule.id, reproduced: false, method: null, detail: "missing fixtures — cannot reproduce" });
      continue;
    }
    const result = await proveWithBest(backends, vulnerableDir, fixedDir, rule);
    if (result.proven) {
      rows.push({
        ruleId: rule.id,
        reproduced: true,
        method: proofMethod(result) as string,
        detail: `RED→GREEN reproduced (${result.proven.redVerdict.detail.split(":")[0]})`,
      });
    } else {
      const tried = result.attempts.map((a) => `${a.method}: red=${a.red} green=${a.green}`).join("; ");
      rows.push({ ruleId: rule.id, reproduced: false, method: null, detail: tried || "no eligible backend" });
    }
  }

  const reproduced = rows.filter((r) => r.reproduced).length;
  if (jsonOut) {
    console.log(JSON.stringify({ pack: pack.manifest.id, oracle: selector, reproduced, total: rows.length, rows }, null, 2));
  } else {
    console.log(`brainblast verify: ${pack.manifest.id} — oracle=${selector}`);
    for (const r of rows) {
      const mark = r.reproduced ? "REPRODUCED" : "FAILED    ";
      const via = r.method ? ` [${r.method}]` : "";
      console.log(`  [${mark}] ${r.ruleId}${via}`);
      console.log(`             ${r.detail}`);
    }
    console.log(`  reproduction rate: ${reproduced}/${rows.length}`);
  }
  process.exit(reproduced === rows.length ? 0 : 1);
}

async function runTelemetry(argv: string[]) {
  const sub = argv[0];
  if (sub !== "submit") {
    console.error("usage: brainblast telemetry submit [targetDir]");
    process.exit(2);
  }

  const targetDir = argv.find((a, i) => i > 0 && !a.startsWith("--")) ?? process.cwd();

  try {
    const result = await submitTelemetry(targetDir);
    if (result.submitted === 0) {
      console.log(`brainblast telemetry submit: no events to submit (${telemetryFilePath(targetDir)} is empty or missing)`);
      return;
    }
    console.log(`brainblast telemetry submit: sent ${result.submitted} event(s) — ${result.accepted} accepted, ${result.rejected} rate-limited`);
    for (const g of result.graduations) {
      if (g.graduated) {
        console.log(`  [GRADUATED] ${g.pack_id}/${g.rule_id}  (${g.distinct_pairs} distinct repo/user pairs)`);
      } else {
        console.log(`  [PROGRESS]  ${g.pack_id}/${g.rule_id}  ${g.distinct_pairs}/5 distinct repo/user pairs`);
      }
    }
  } catch (e: any) {
    console.error(`brainblast telemetry submit: ${e.message ?? String(e)}`);
    process.exit(1);
  }
}

async function runTrustGraph(argv: string[]) {
  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : undefined;
  const noProbe = argv.includes("--no-probe");
  const jsonOut = argv.includes("--json");
  const ids = argv.filter((a) => !a.startsWith("--") && a !== rpcUrl);

  if (ids.length === 0) {
    console.error("usage: brainblast trust-graph <programId> [<programId>...] [--rpc URL] [--no-probe] [--json]");
    process.exit(1);
  }
  for (const id of ids) {
    if (!isValidSolanaAddress(id)) {
      console.error(`error: '${id}' is not a valid Solana address`);
      process.exit(1);
    }
  }

  const noCache = argv.includes("--no-cache");

  const graph = await buildTrustGraph(ids, {
    rpcUrl,
    probeRpc: !noProbe,
    cachePath: noCache ? null : undefined,
  });
  if (jsonOut) {
    console.log(JSON.stringify(graph, null, 2));
  } else {
    console.log(renderTrustGraphMd(graph));
  }
  if (!noCache) {
    const cp = defaultCachePath();
    const count = cacheSize(loadProgramCache(cp));
    console.error(`  program-cache: ${count} entries  (${cp})`);
  }
}

async function runFix(argv: string[]) {
  const apply = argv.includes("--apply");
  const branch = argv.includes("--branch");
  const targetDir = argv.find((a) => !a.startsWith("--")) ?? process.cwd();

  const rules = resolveRules(targetDir, parsePackDirs(argv));
  const { checks: before } = audit(targetDir, rules);
  const fixable = before.filter((c) => c.result === "fail" && c.fix?.diff);

  if (fixable.length === 0) {
    console.log("brainblast fix: no mechanical fixes available (no FAIL ships a fix.diff).");
    const others = before.filter((c) => c.result === "fail" && c.fix?.suggestion);
    for (const c of others) {
      console.log(`  [GUIDANCE] ${c.ruleId}  ${c.file}:${c.line}`);
      console.log(`             ${c.fix!.summary}`);
    }
    return;
  }

  console.log(`brainblast fix: ${fixable.length} mechanical fix(es) found.`);
  for (const c of fixable) {
    console.log(`  [${apply ? "APPLY" : "DRY-RUN"}] ${c.ruleId}  ${c.file}:${c.line} — ${c.fix!.summary}`);
  }

  if (!apply) {
    console.log("\nRe-run with --apply to write these changes to disk.");
    return;
  }

  // Apply bottom-up per file so earlier hunks don't shift later line numbers.
  const byFile = new Map<string, typeof fixable>();
  for (const c of fixable) {
    const file = parseDiff(c.fix!.diff!).filePath;
    byFile.set(file, [...(byFile.get(file) ?? []), c]);
  }

  let applied = 0;
  let skipped = 0;
  for (const [, group] of byFile) {
    const sorted = [...group].sort((a, b) => parseDiff(b.fix!.diff!).oldStart - parseDiff(a.fix!.diff!).oldStart);
    for (const c of sorted) {
      const ok = applyDiffToFile(c.fix!.diff!);
      if (ok) applied++;
      else {
        skipped++;
        console.log(`  [SKIP] ${c.ruleId}  ${c.file}:${c.line} — file no longer matches the fix's expected range`);
      }
    }
  }
  console.log(`\nApplied ${applied} fix(es)${skipped ? `, skipped ${skipped}` : ""}.`);

  // Re-audit to confirm RED -> GREEN for the fixes we applied.
  const { checks: after } = audit(targetDir, rules);
  const stillFailing = fixable.filter((c) => {
    const a = after.find((x) => x.ruleId === c.ruleId && x.file === c.file && x.exportName === c.exportName);
    return a?.result === "fail";
  });
  if (stillFailing.length > 0) {
    console.log(`\nWarning: ${stillFailing.length} fix(es) applied but the rule still fails:`);
    for (const c of stillFailing) console.log(`  ${c.ruleId}  ${c.file}:${c.line}`);
  } else if (applied > 0) {
    console.log("All applied fixes now pass (or cant_tell) on re-audit. ✓");
  }

  if (isTelemetryEnabled(targetDir)) {
    const graduated = fixable.filter((c) => !stillFailing.includes(c));
    const events = graduated
      .map((c) => rules.find((r) => r.id === c.ruleId))
      .filter((r): r is (typeof rules)[number] & { pack: NonNullable<(typeof rules)[number]["pack"]> } => !!r?.pack)
      .map((r) => ({ pack_id: r.pack.id, rule_id: r.id }));
    if (events.length > 0) {
      recordGraduationEvents(targetDir, events);
      console.log(`\nTelemetry: recorded ${events.length} graduation event(s) to ${telemetryFilePath(targetDir)}`);
    }
  }

  if (branch && applied > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const branchName = `brainblast/auto-fix-${ts}`;
    try {
      execFileSync("git", ["checkout", "-b", branchName], { cwd: targetDir, stdio: "ignore" });
      execFileSync("git", ["add", "-A"], { cwd: targetDir, stdio: "ignore" });
      execFileSync(
        "git",
        ["commit", "-q", "-m", `brainblast fix: apply ${applied} mechanical fix(es)`],
        { cwd: targetDir, stdio: "ignore" },
      );
      console.log(`\nCommitted to new branch '${branchName}'.`);
    } catch (e: any) {
      console.error(`\nWarning: could not create branch/commit: ${e.message ?? e}`);
    }
  }
}

// ── brainblast drift ─────────────────────────────────────────────────────────

async function runDrift(argv: string[]) {
  const updateBaseline = argv.includes("--update-baseline");
  const jsonOut = argv.includes("--json");
  const targetDir = argv.find((a) => !a.startsWith("--")) ?? process.cwd();

  const { checkDrift, renderDriftText } = await import("./drift.ts");

  let result;
  try {
    result = await checkDrift(targetDir, { updateBaseline });
  } catch (e: any) {
    console.error(`brainblast drift: ${e.message ?? String(e)}`);
    process.exit(1);
  }

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
    if (result.newAdvisories.length > 0) process.exit(1);
    return;
  }

  console.log(renderDriftText(result));
  if (result.newAdvisories.length > 0) process.exit(1);
}

// ── brainblast diff ──────────────────────────────────────────────────────────

function splitPkgVersion(arg: string): [string, string] {
  if (arg.startsWith("@")) {
    // scoped: @scope/name@version
    const rest = arg.slice(1);
    const at = rest.lastIndexOf("@");
    if (at < 0) return [arg, ""];
    return [`@${rest.slice(0, at)}`, rest.slice(at + 1)];
  }
  const at = arg.lastIndexOf("@");
  if (at <= 0) return [arg, ""];
  return [arg.slice(0, at), arg.slice(at + 1)];
}

function guessEcosystem(name: string): string {
  if (name.includes("/") && !name.startsWith("@")) return "Go";
  return "npm";
}

async function runDiff(argv: string[]) {
  const flag = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ecoFlag = flag("ecosystem");
  const fromFlag = flag("from");
  const toFlag = flag("to");
  const jsonOut = argv.includes("--json");
  const skipValues = new Set([ecoFlag, fromFlag, toFlag].filter(Boolean));
  const positional = argv.filter((a) => !a.startsWith("--") && !skipValues.has(a));

  let pkgName: string;
  let fromVersion: string;
  let toVersion: string;
  let ecosystem: string;

  if (positional.length === 2 && positional[0].includes("@") && positional[1].includes("@")) {
    const [n1, v1] = splitPkgVersion(positional[0]);
    const [n2, v2] = splitPkgVersion(positional[1]);
    if (n1 !== n2) {
      console.error(`error: package names must match ('${n1}' vs '${n2}')`);
      process.exit(2);
    }
    if (!v1 || !v2) {
      console.error("error: could not parse versions from arguments");
      process.exit(2);
    }
    pkgName = n1;
    fromVersion = v1;
    toVersion = v2;
    ecosystem = ecoFlag ?? guessEcosystem(pkgName);
  } else if (positional.length >= 1 && fromFlag && toFlag) {
    pkgName = positional[0];
    fromVersion = fromFlag;
    toVersion = toFlag;
    ecosystem = ecoFlag ?? guessEcosystem(pkgName);
  } else {
    console.error("usage: brainblast diff <pkg>@<from> <pkg>@<to> [--ecosystem <eco>]");
    console.error("   or: brainblast diff <pkg> --from <v1> --to <v2> [--ecosystem <eco>]");
    console.error("  e.g.: brainblast diff lodash@4.17.20 lodash@4.17.21");
    process.exit(2);
  }

  const { diffVersions, renderDiffText, renderDiffMd: _renderDiffMd, riskScore } = await import("./diff.ts");

  let result;
  try {
    result = await diffVersions(ecosystem, pkgName, fromVersion, toVersion);
  } catch (e: any) {
    console.error(`brainblast diff: ${e.message ?? String(e)}`);
    process.exit(1);
  }

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(renderDiffText(result));

  const score = riskScore(result);
  if (score > 0) {
    console.error(`\nUpgrade INCREASES risk (score: +${score}). Review introduced advisories before bumping.`);
    process.exit(1);
  } else if (score < 0) {
    console.log(`\nUpgrade DECREASES risk (score: ${score}). Upgrade recommended.`);
  } else if (result.unchanged.length > 0) {
    console.log(`\nRisk profile unchanged (${result.unchanged.length} advisory${result.unchanged.length !== 1 ? "ies" : ""} persist in both versions).`);
  } else {
    console.log("\nNo known advisories for either version.");
  }
}

async function runRico(argv: string[]): Promise<void> {
  const { analyzeToken, renderRicoText } = await import("./ricomaps.ts");
  const { verifyTokenIdentity } = await import("./tokenRegistry.ts");

  const mint = argv.find((a) => !a.startsWith("--"));
  if (!mint) {
    console.error("usage: brainblast rico <mint> [--expect SYMBOL] [--api-key KEY] [--fail-on SCORE] [--offline] [--json]");
    process.exit(2);
  }

  const expectIdx = argv.indexOf("--expect");
  const expectSymbol = expectIdx >= 0 ? argv[expectIdx + 1] : undefined;
  const apiKeyIdx = argv.indexOf("--api-key");
  let apiKey = apiKeyIdx >= 0 ? argv[apiKeyIdx + 1] : undefined;
  const failOnIdx = argv.indexOf("--fail-on");
  const failOn = failOnIdx >= 0 ? parseInt(argv[failOnIdx + 1], 10) : 70;
  const offline = argv.includes("--offline");
  const jsonOut = argv.includes("--json");

  // ── Quality scan (Rico Maps) ─────────────────────────────────────────────
  let ricoResult: Awaited<ReturnType<typeof analyzeToken>> | null = null;

  if (!offline) {
    ricoResult = await analyzeToken(mint, { apiKey });

    if (!ricoResult.ok && ricoResult.kind === "auth") {
      // Graceful-skip: prompt for key or skip
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          "\nRico Maps API key missing or invalid.\n  [s] Skip quality scan\n  [k] Enter API key\nChoice: ",
          resolve
        );
      });
      rl.close();

      if (answer.trim().toLowerCase().startsWith("k")) {
        const rl2 = readline.createInterface({ input: process.stdin, output: process.stderr });
        apiKey = await new Promise<string>((resolve) => {
          rl2.question("API key: ", resolve);
        });
        rl2.close();
        ricoResult = await analyzeToken(mint, { apiKey });
      } else {
        ricoResult = null; // skip
      }
    }
  }

  // ── Identity check ───────────────────────────────────────────────────────
  const claimedSymbol = ricoResult?.ok ? ricoResult.result.symbol : undefined;
  const identity = await verifyTokenIdentity(mint, { expectSymbol, claimedSymbol, offline });

  if (jsonOut) {
    console.log(JSON.stringify({ identity, quality: ricoResult?.ok ? ricoResult.result : null }, null, 2));
  } else {
    // Identity block
    const impTag = identity.impersonation ? " ⚠ IMPERSONATION" : "";
    const expectTag = identity.expectMismatch ? " ⚠ EXPECT MISMATCH" : "";
    console.log(`\nIdentity  [${identity.status}]${impTag}${expectTag}`);
    if (identity.symbol) console.log(`  Symbol:  ${identity.symbol}`);
    if (identity.name) console.log(`  Name:    ${identity.name}`);
    console.log(`  Source:  ${identity.source}`);
    if (identity.impersonation && identity.canonicalMint) {
      console.log(`  Canonical ${identity.symbol} mint: ${identity.canonicalMint}`);
      console.log(`  This token: ${mint}`);
    }
    if (identity.detail) console.log(`  Note:    ${identity.detail}`);

    // Quality block
    if (ricoResult === null) {
      console.log("\nQuality   [skipped]");
    } else if (!ricoResult.ok) {
      console.log(`\nQuality   [error: ${ricoResult.kind}] ${ricoResult.error}`);
      if (ricoResult.kind === "rate-limit" && ricoResult.retryAfterMs) {
        console.log(`  Retry after: ${Math.ceil(ricoResult.retryAfterMs / 1000)}s`);
      }
    } else {
      console.log(`\n${renderRicoText(ricoResult.result)}`);
    }
    console.log("");
  }

  // ── Exit code ────────────────────────────────────────────────────────────
  const highRisk = ricoResult?.ok && ricoResult.result.riskScore >= failOn;
  if (identity.impersonation || identity.expectMismatch || highRisk) {
    process.exit(1);
  }
}

async function runFirewall(argv: string[]): Promise<void> {
  const { inspectTransaction, renderFirewallText } = await import("./firewall.ts");

  const tx = argv.find((a) => !a.startsWith("--"));
  if (!tx) {
    console.error("usage: brainblast firewall <base64-tx> [--rpc URL] [--no-simulate] [--message-only] [--strict] [--json]");
    console.error("  Inspect a serialized Solana transaction before an agent signs it.");
    console.error("  Exit 1 on BLOCK verdict (or any WARN with --strict).");
    process.exit(2);
  }

  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : undefined;
  const noSimulate = argv.includes("--no-simulate");
  const messageOnly = argv.includes("--message-only");
  const strict = argv.includes("--strict");
  const jsonOut = argv.includes("--json");

  let report;
  try {
    report = await inspectTransaction(tx, { rpcUrl, simulate: !noSimulate, messageOnly });
  } catch (e: any) {
    console.error(`brainblast firewall: ${e?.message ?? String(e)}`);
    process.exit(2);
  }

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderFirewallText(report));
  }

  if (report.verdict === "block" || (strict && report.verdict === "warn")) {
    process.exit(1);
  }
}

async function runIdlRules(argv: string[]): Promise<void> {
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { parseIdl, generateRulesFromIdl, renderRulesYaml } = await import("./idlRules.ts");

  const idlPath = argv.find((a) => !a.startsWith("--"));
  if (!idlPath) {
    console.error("usage: brainblast idl-rules <idl.json> [--out <dir>] [--json]");
    console.error("  Generate brainblast rules from an Anchor IDL's account constraints.");
    process.exit(2);
  }

  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  const jsonOut = argv.includes("--json");

  let idl;
  try {
    idl = parseIdl(JSON.parse(readFileSync(idlPath, "utf8")));
  } catch (e: any) {
    console.error(`brainblast idl-rules: ${e?.message ?? String(e)}`);
    process.exit(2);
  }

  const rules = generateRulesFromIdl(idl);
  if (rules.length === 0) {
    console.error("brainblast idl-rules: IDL produced no rules (no instructions?)");
    process.exit(1);
  }

  if (jsonOut) {
    console.log(JSON.stringify(rules, null, 2));
    return;
  }

  const yaml = renderRulesYaml(rules);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `${rules[0].id}.yaml`);
    writeFileSync(file, yaml);
    console.log(`Generated ${rules.length} rule(s) → ${file}`);
    console.log(`  Run against your program:  npx brainblast <program-dir> --packs <pack-with-this-rule>`);
  } else {
    console.log(yaml);
  }
}

async function runScore(argv: string[]): Promise<void> {
  const { scoreProgram, renderScoreText, gradeAtLeast } = await import("./score.ts");
  const { isValidSolanaAddress } = await import("./trustGraph/index.ts");

  const programId = argv.find((a) => !a.startsWith("--"));
  if (!programId) {
    console.error("usage: brainblast score <program-id> [--rpc URL] [--no-probe] [--min A|B|C|D|F] [--json]");
    console.error("  Compute a 0-100 trust score + A-F grade for a deployed Solana program.");
    process.exit(2);
  }
  if (!isValidSolanaAddress(programId)) {
    console.error(`brainblast score: not a valid Solana address: ${programId}`);
    process.exit(2);
  }

  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : undefined;
  const noProbe = argv.includes("--no-probe");
  const minIdx = argv.indexOf("--min");
  const min = minIdx >= 0 ? (argv[minIdx + 1] as "A" | "B" | "C" | "D" | "F") : undefined;
  const jsonOut = argv.includes("--json");

  let result;
  try {
    result = await scoreProgram(programId, { rpcUrl, probeRpc: !noProbe });
  } catch (e: any) {
    console.error(`brainblast score: ${e?.message ?? String(e)}`);
    process.exit(1);
  }

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderScoreText(result));
  }

  if (min && !gradeAtLeast(result.grade, min)) {
    process.exit(1);
  }
}

// Parse program IDs declared in an Anchor.toml ([programs.*] sections), so the
// on-chain step can ask "is one of my keys the upgrade authority of these?".
async function parseAnchorProgramIds(dir: string): Promise<string[]> {
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const p = join(dir, "Anchor.toml");
    if (!existsSync(p)) return [];
    const ids = new Set<string>();
    let inPrograms = false;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("[")) inPrograms = /^\[programs\./.test(t);
      else if (inPrograms) {
        const m = t.match(/=\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/);
        if (m) ids.add(m[1]);
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

async function runKeys(argv: string[]): Promise<void> {
  const { scanSecrets, renderKeysText, renderAuditText, auditReport } = await import("./keys/scan.ts");
  const { enrichSecretsOnchain } = await import("./keys/onchain.ts");
  const vault = await import("./keys/vault.ts");
  const os = await import("node:os");
  const { join } = await import("node:path");

  if (argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast keys [dir] [--json] [--offline] [--no-vault] [--project-only] [--include PATH] [--rpc URL] [--fail-on funds|exposed]");
    console.error("  Find every irreplaceable Solana secret (keypairs, seed phrases, .env keys) and rank it by");
    console.error("  blast radius — what you permanently lose if an agent deletes it. Resolves on-chain whether a");
    console.error("  key is a live program's SOLE UPGRADE AUTHORITY (☠ terminal) or holds SOL (funds), and whether");
    console.error("  the Vault can recover it. Exit 1 when a high-tier secret is committed (leak) or unbacked.");
    process.exit(2);
  }

  const dir = argv.find((a) => !a.startsWith("--")) ?? ".";
  const jsonOut = argv.includes("--json");
  const auditMode = argv.includes("--audit");
  const offline = argv.includes("--offline");
  const noVault = argv.includes("--no-vault");
  const projectOnly = argv.includes("--project-only");
  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : undefined;
  const failIdx = argv.indexOf("--fail-on");
  const failOn = failIdx >= 0 ? argv[failIdx + 1] : "exposed";

  const extraPaths: string[] = [];
  if (!projectOnly) {
    // The single most-deleted irreplaceable file: the default CLI wallet.
    extraPaths.push(join(os.homedir(), ".config", "solana", "id.json"));
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--include" && argv[i + 1]) extraPaths.push(argv[i + 1]);
  }

  const vaultLookup = noVault ? undefined : (abs: string) => vault.isBackedUp(abs);

  let report;
  try {
    report = scanSecrets(dir, { extraPaths, vaultLookup });
    if (!offline) {
      report = await enrichSecretsOnchain(report, { rpcUrl, programIds: await parseAnchorProgramIds(dir) });
    }
  } catch (e: any) {
    console.error(`brainblast keys: ${e?.message ?? String(e)}`);
    process.exit(2);
  }

  if (auditMode) {
    const audit = auditReport(report);
    if (jsonOut) console.log(JSON.stringify({ ...report, audit }, null, 2));
    else console.log(renderAuditText(report));
    process.exit(audit.pass ? 0 : 1);
  }

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderKeysText(report));
  }

  // --fail-on exposed (default): exit 1 only on the headline failure.
  // --fail-on funds: also exit 1 if any unbacked high-tier secret exists at all.
  if (report.verdict === "exposed") process.exit(1);
  if (failOn === "funds" && report.summary.unrecoverable > 0) process.exit(1);
}

async function runRescue(argv: string[]): Promise<void> {
  const { rescue, renderRescueText } = await import("./keys/rescue.ts");
  if (argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast rescue [dir] [--json] [--no-history]");
    console.error("  After something may have been deleted: what the Vault can bring back, what's still at");
    console.error("  risk, and (from shell history) the command that likely did it. Exit 1 if anything is");
    console.error("  recoverable-but-not-yet-restored or unbacked.");
    process.exit(2);
  }
  const dir = argv.find((a) => !a.startsWith("--")) ?? ".";
  const report = rescue(dir, { includeHistory: !argv.includes("--no-history") });
  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else console.log(renderRescueText(report));
  process.exit(report.recoverableMissing > 0 || report.unbackedAtRisk > 0 ? 1 : 0);
}

async function runVault(argv: string[]): Promise<void> {
  const vault = await import("./keys/vault.ts");
  const { scanSecrets } = await import("./keys/scan.ts");
  const { statSync } = await import("node:fs");
  const isDir = (p: string): boolean => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === "--help" || sub === "-h") {
    console.error("usage: brainblast vault <command>");
    console.error("  backup [dir|file...]   back up high-tier secrets (or specific files) into the encrypted Vault");
    console.error("  status [dir]           show which detected secrets are backed up");
    console.error("  list                   list the latest snapshot per path");
    console.error("  restore <path|pubkey>  restore a secret from the Vault [--to DEST] [--force] [--by-pubkey]");
    console.error("  trash <file>           back up a file, then delete it (safe soft-delete)");
    console.error("  verify                 check every indexed snapshot's object is present");
    console.error("");
    console.error("  The Vault lives at ~/.brainblast/vault (override BRAINBLAST_VAULT_DIR), encrypted with a");
    console.error("  local key or BRAINBLAST_VAULT_PASSPHRASE. It is OUTSIDE your repo, so rm/git-clean can't reach it.");
    process.exit(2);
  }

  if (sub === "backup") {
    const targets = rest.filter((a) => !a.startsWith("--"));
    let files: { path: string; pubkey?: string; kind?: string; tier?: string }[] = [];
    if (targets.length === 0 || targets.every((t) => isDir(t))) {
      // Back up the high-tier secrets found by scanning the dir (default: cwd).
      const dir = targets[0] ?? ".";
      const report = scanSecrets(dir, {});
      files = report.secrets
        .filter((s) => s.tier === "terminal" || s.tier === "funds" || s.tier === "unknown")
        .map((s) => ({ path: s.path, pubkey: s.pubkey, kind: s.kind, tier: s.tier }));
    } else {
      files = targets.map((t) => ({ path: t }));
    }
    if (files.length === 0) {
      console.log("vault: nothing to back up (no high-tier secrets found).");
      process.exit(0);
    }
    for (const f of files) {
      try {
        const { deduped } = vault.backupFile(f.path, { pubkey: f.pubkey, kind: f.kind, tier: f.tier });
        console.log(`  ${deduped ? "·" : "✓"} ${f.path}${deduped ? " (already stored)" : " backed up"}`);
      } catch (e: any) {
        console.error(`  ✗ ${f.path}: ${e?.message ?? String(e)}`);
      }
    }
    process.exit(0);
  }

  if (sub === "status") {
    const dir = rest.find((a) => !a.startsWith("--")) ?? ".";
    const report = scanSecrets(dir, { vaultLookup: (abs) => vault.isBackedUp(abs) });
    const interesting = report.secrets.filter((s) => s.tier !== "trivial");
    if (interesting.length === 0) {
      console.log("No high-tier secrets detected.");
      process.exit(0);
    }
    for (const s of interesting) {
      console.log(`  ${s.vaulted ? "✓ backed up" : "✗ NOT backed up"}  ${s.rel}`);
    }
    const unbacked = interesting.filter((s) => !s.vaulted).length;
    process.exit(unbacked > 0 ? 1 : 0);
  }

  if (sub === "list") {
    const entries = vault.listLatestByPath();
    if (entries.length === 0) {
      console.log("Vault is empty.");
      process.exit(0);
    }
    for (const e of entries) {
      console.log(`  ${e.ts}  ${e.path}${e.pubkey ? `  (${e.pubkey})` : ""}`);
    }
    process.exit(0);
  }

  if (sub === "restore") {
    const query = rest.find((a) => !a.startsWith("--"));
    if (!query) {
      console.error("usage: brainblast vault restore <path|pubkey> [--to DEST] [--force] [--by-pubkey]");
      process.exit(2);
    }
    const toIdx = rest.indexOf("--to");
    const to = toIdx >= 0 ? rest[toIdx + 1] : undefined;
    try {
      const r = vault.restore(query, { to, force: rest.includes("--force"), byPubkey: rest.includes("--by-pubkey") });
      console.log(`✓ restored ${r.restoredTo}  (snapshot ${r.ts})`);
    } catch (e: any) {
      console.error(`vault restore: ${e?.message ?? String(e)}`);
      process.exit(2);
    }
    process.exit(0);
  }

  if (sub === "trash") {
    const target = rest.find((a) => !a.startsWith("--"));
    if (!target) {
      console.error("usage: brainblast vault trash <file>");
      process.exit(2);
    }
    try {
      vault.trash(target);
      console.log(`✓ ${target} backed up and removed (restore with: brainblast vault restore ${target})`);
    } catch (e: any) {
      console.error(`vault trash: ${e?.message ?? String(e)}`);
      process.exit(2);
    }
    process.exit(0);
  }

  if (sub === "verify") {
    const v = vault.verifyVault();
    if (v.ok) {
      console.log("✓ Vault integrity OK — every snapshot's object is present.");
      process.exit(0);
    }
    console.error(`✗ Vault missing ${v.missing.length} object(s): ${v.missing.join(", ")}`);
    process.exit(1);
  }

  console.error(`brainblast vault: unknown command '${sub}'`);
  process.exit(2);
}

async function runWalletCheck(argv: string[]): Promise<void> {
  const { analyzeWallet, renderWalletText } = await import("./wallet/analyze.ts");

  if (argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast wallet-check [dir] [--strict] [--json]");
    console.error("  Reconcile a Solana frontend's declared network (.env) against its actual wallet-adapter");
    console.error("  wiring. Flags network mismatch, dead/unwired network env vars, the rate-limited public");
    console.error("  mainnet RPC, RPC keys exposed in NEXT_PUBLIC_*, and a wallet UI missing its stylesheet.");
    console.error("  Exit 1 on a critical mismatch (or any finding with --strict).");
    process.exit(2);
  }

  const dir = argv.find((a) => !a.startsWith("--")) ?? ".";
  const report = analyzeWallet(dir);

  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else console.log(renderWalletText(report));

  if (report.verdict === "block") process.exit(1);
  if (argv.includes("--strict") && report.findings.length > 0) process.exit(1);
}

async function runSignguard(argv: string[]): Promise<void> {
  const sg = await import("./signguard/index.ts");
  const { evaluateSolanaCommand } = await import("./signguard/commands.ts");
  const mode = argv[0];

  if (mode === "init") {
    const dir = argv.find((a, i) => i > 0 && !a.startsWith("--")) ?? ".";
    try {
      const path = sg.scaffoldPolicy(dir);
      console.log(`✓ wrote secure-default signing policy to ${path}`);
      console.log("  Edit it to set maxSolPerTx, allowedPrograms, allowedRecipients, and per-action rules.");
    } catch (e: any) {
      console.error(`signguard init: ${e?.message ?? String(e)}`);
      process.exit(2);
    }
    process.exit(0);
  }

  if (mode === "session") {
    const s = sg.loadSession();
    console.log(`Signguard session — ${s.solOut.toFixed(4)} SOL across ${s.txCount} tx (since ${s.startedAt})`);
    process.exit(0);
  }
  if (mode === "reset") {
    sg.resetSession();
    console.log("✓ Signguard session ledger reset to 0.");
    process.exit(0);
  }

  if (mode === "hook") {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    let payload: any = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      process.exit(0);
    }
    if (payload.tool_name !== "Bash" || typeof payload.tool_input?.command !== "string") process.exit(0);
    const { policy } = sg.loadPolicy({ cwd: payload.cwd });
    const v = evaluateSolanaCommand(payload.tool_input.command, policy, { sessionSolOut: sg.loadSession().solOut });
    if (!v.recognized || v.decision === "allow") process.exit(0);
    const out = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: v.decision === "block" ? "deny" : "ask",
        permissionDecisionReason: `[Brainblast Signguard] ${v.message}`,
      },
    };
    console.log(JSON.stringify(out));
    process.exit(0);
  }

  // Default: evaluate a base64-serialized transaction against the policy.
  const tx = argv.find((a) => !a.startsWith("--"));
  if (!tx) {
    console.error("usage: brainblast signguard <base64-tx> [--policy FILE] [--max-sol N] [--record] [--no-sim] [--rpc URL] [--json]");
    console.error("       brainblast signguard init | session | reset | hook");
    console.error("  Decode a transaction and check it against your standing signing policy (spend caps, program");
    console.error("  allowlist, authority/upgrade/delegate rules, recipient allowlist). Exit 1 on block.");
    process.exit(2);
  }
  const polIdx = argv.indexOf("--policy");
  const policyPath = polIdx >= 0 ? argv[polIdx + 1] : undefined;
  const { policy, source } = sg.loadPolicy({ policyPath });
  const maxIdx = argv.indexOf("--max-sol");
  if (maxIdx >= 0) policy.maxSolPerTx = parseFloat(argv[maxIdx + 1]);
  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : undefined;
  const jsonOut = argv.includes("--json");

  let result;
  try {
    result = await sg.inspectSigning(tx, {
      policy,
      rpcUrl,
      simulate: !argv.includes("--no-sim"),
      sessionSolOut: sg.loadSession().solOut,
    });
  } catch (e: any) {
    console.error(`signguard: ${e?.message ?? String(e)}`);
    process.exit(2);
  }

  if (argv.includes("--record") && result.decision !== "block") sg.recordSpend(result.solOut);

  if (jsonOut) console.log(JSON.stringify({ ...result, policySource: source }, null, 2));
  else console.log(sg.renderSignguardText(result, source));

  process.exit(result.decision === "block" ? 1 : 0);
}

async function runGuard(argv: string[]): Promise<void> {
  const { evaluateCommand, evaluateOverwrite } = await import("./keys/guard.ts");
  const vault = await import("./keys/vault.ts");
  const vaultLookup = (abs: string) => vault.isBackedUp(abs);
  const mode = argv[0];

  if (mode === "install") {
    const snippet = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit",
            hooks: [{ type: "command", command: "npx brainblast guard hook" }],
          },
        ],
      },
    };
    console.log("Add this to your Claude Code settings.json (~/.claude/settings.json) to arm the Guard:");
    console.log("");
    console.log(JSON.stringify(snippet, null, 2));
    console.log("");
    console.log("Then any rm -rf / git clean / overwrite that would destroy an irreplaceable Solana secret is");
    console.log("blocked before it runs. Codex: wrap destructive commands with `brainblast guard <command>`.");
    process.exit(0);
  }

  if (mode === "hook") {
    // Read a Claude Code PreToolUse payload from stdin and emit a decision.
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    let payload: any = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      process.exit(0); // not our payload — don't interfere
    }
    const tool = payload.tool_name;
    const cwd = payload.cwd || process.cwd();
    const input = payload.tool_input || {};

    let verdict;
    if (tool === "Bash" && typeof input.command === "string") {
      verdict = evaluateCommand(input.command, { cwd, vaultLookup });
    } else if (
      (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") &&
      typeof input.file_path === "string"
    ) {
      verdict = evaluateOverwrite(input.file_path, { cwd, vaultLookup });
    } else {
      process.exit(0); // nothing we guard — allow
    }

    if (verdict.decision === "allow") process.exit(0);

    const reason = verdict.safeAlternative
      ? `${verdict.message}\n\nSafe alternative:\n${verdict.safeAlternative}`
      : verdict.message;
    const out = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: verdict.decision === "block" ? "deny" : "ask",
        permissionDecisionReason: `[Brainblast Keyguard] ${reason}`,
      },
    };
    console.log(JSON.stringify(out));
    process.exit(0);
  }

  // Direct mode: evaluate a command string (for testing / Codex wrapping).
  const command = argv.join(" ").trim();
  if (!command) {
    console.error("usage: brainblast guard <command>   |   guard hook   |   guard install");
    console.error("  Evaluate a destructive command against your irreplaceable secrets. Exit 1 if it would");
    console.error("  destroy one. `guard hook` is the Claude Code PreToolUse entrypoint; `guard install` prints setup.");
    process.exit(2);
  }
  const verdict = evaluateCommand(command, { vaultLookup });
  const icon = verdict.decision === "block" ? "⛔" : verdict.decision === "warn" ? "⚠️" : "✅";
  console.log(`${icon} ${verdict.message}`);
  if (verdict.safeAlternative) console.log(`\nSafe alternative:\n${verdict.safeAlternative}`);
  process.exit(verdict.decision === "block" ? 1 : 0);
}

async function runPumpCheck(argv: string[]): Promise<void> {
  const { pumpPreflight, renderPreflightText } = await import("./pumpCheck.ts");

  const mint = argv.find((a) => !a.startsWith("--"));
  if (!mint) {
    console.error("usage: brainblast pump-check <mint> [--rpc URL] [--api-key KEY] [--fail-on SCORE] [--offline] [--json]");
    console.error("  Launch pre-flight: mint/freeze authority, identity, and Rico Maps forensics → GO/CAUTION/NO-GO.");
    process.exit(2);
  }

  const rpcIdx = argv.indexOf("--rpc");
  const rpcUrl = rpcIdx >= 0 ? argv[rpcIdx + 1] : undefined;
  const keyIdx = argv.indexOf("--api-key");
  const apiKey = keyIdx >= 0 ? argv[keyIdx + 1] : undefined;
  const failIdx = argv.indexOf("--fail-on");
  const failOnRisk = failIdx >= 0 ? parseInt(argv[failIdx + 1], 10) : undefined;
  const offline = argv.includes("--offline");
  const jsonOut = argv.includes("--json");

  let report;
  try {
    report = await pumpPreflight(mint, { rpcUrl, apiKey, failOnRisk, offline });
  } catch (e: any) {
    console.error(`brainblast pump-check: ${e?.message ?? String(e)}`);
    process.exit(2);
  }

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderPreflightText(report));
  }

  if (report.verdict === "NO-GO") process.exit(1);
}

async function runBatch(argv: string[]): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { batchScan, parseMintList, renderBatchText } = await import("./batchScan.ts");

  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: brainblast batch <file> [--concurrency N] [--api-key KEY] [--fail-on SCORE] [--offline] [--json]");
    console.error("  Risk-rank a list of contract addresses (newline-separated or JSON array).");
    process.exit(2);
  }

  let mints: string[];
  try {
    mints = parseMintList(readFileSync(file, "utf8"));
  } catch (e: any) {
    console.error(`brainblast batch: ${e?.message ?? String(e)}`);
    process.exit(2);
  }
  if (mints.length === 0) {
    console.error("brainblast batch: no addresses found in file");
    process.exit(2);
  }

  const concIdx = argv.indexOf("--concurrency");
  const concurrency = concIdx >= 0 ? parseInt(argv[concIdx + 1], 10) : undefined;
  const keyIdx = argv.indexOf("--api-key");
  const apiKey = keyIdx >= 0 ? argv[keyIdx + 1] : undefined;
  const failIdx = argv.indexOf("--fail-on");
  const failOnRisk = failIdx >= 0 ? parseInt(argv[failIdx + 1], 10) : undefined;
  const offline = argv.includes("--offline");
  const jsonOut = argv.includes("--json");

  const result = await batchScan(mints, { concurrency, apiKey, failOnRisk, offline });

  if (jsonOut) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderBatchText(result));
  }

  if (result.summary.impersonators > 0 || result.summary.highRisk > 0) {
    process.exit(1);
  }
}
