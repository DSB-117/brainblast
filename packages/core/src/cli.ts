#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
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
import { isContributeEnabled, contributeConsentScope, contribStagingDir, stageContribution } from "./contrib/capture.ts";
import type { FeedTier, FeedQuery } from "./feed.ts";

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
  runPack(args.slice(1));
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

if (args[0] === "wallet") {
  await runWallet(args.slice(1));
  process.exit(0);
}

if (args[0] === "feed") {
  await runFeed(args.slice(1));
  process.exit(0);
}

if (args[0] === "catalog") {
  await runCatalog(args.slice(1));
  process.exit(0);
}

if (args[0] === "grant") {
  await runGrant(args.slice(1));
  process.exit(0);
}

if (args[0] === "usage") {
  await runUsage(args.slice(1));
  process.exit(0);
}

if (args[0] === "serve") {
  await runServe(args.slice(1)); // resolves only on shutdown; keeps the process alive while serving
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

function runPack(argv: string[]) {
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
    const result = validatePack(dir);
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

  // Contribution capture (opt-in): snapshot each soon-to-be-fixed file's BEFORE
  // content so a confirmed RED→GREEN fix can be captured as a candidate VTI.
  const contribute = isContributeEnabled(targetDir);
  const beforeContent = new Map<string, string>();
  if (contribute) {
    for (const c of fixable) {
      if (beforeContent.has(c.file)) continue;
      try {
        beforeContent.set(c.file, readFileSync(c.file, "utf8"));
      } catch {
        /* unreadable — skip capture for this file */
      }
    }
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

  // Contribution capture (opt-in): stage the before/after content of each
  // confirmed RED→GREEN fix. stageContribution refuses any pair holding a secret.
  if (contribute) {
    const graduated = fixable.filter((c) => !stillFailing.includes(c));
    let stagedN = 0;
    for (const c of graduated) {
      const before = beforeContent.get(c.file);
      if (before === undefined) continue;
      let after: string;
      try {
        after = readFileSync(c.file, "utf8");
      } catch {
        continue;
      }
      const res = stageContribution(targetDir, { ruleId: c.ruleId, file: relative(targetDir, c.file), vulnerable: before, fixed: after });
      if (res.staged) stagedN++;
      else if (res.reason?.includes("secret")) console.log(`  [contribute] skipped ${c.ruleId}: ${res.reason}`);
    }
    if (stagedN > 0) {
      console.log(
        `\nContribute: staged ${stagedN} candidate(s) to ${contribStagingDir(targetDir)} ` +
          `(consent=${contributeConsentScope(targetDir)}). Ingest with: npm run ingest:vti -- --from-staging .`,
      );
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

// Client mode for `feed --remote <url>`: GET <url>/feed with our query + grant
// header, stream the NDJSON response straight to stdout. The server enforces
// entitlement; we just present the grant and print what we're given.
async function feedFromRemote(remote: string, argv: string[], val: (f: string) => string | undefined): Promise<void> {
  const base = remote.replace(/\/+$/, "");
  const params = new URLSearchParams();
  const map: Record<string, string> = {
    "--sdk": "sdk",
    "--class": "class",
    "--severity": "severity",
    "--min-corroboration": "min_corroboration",
    "--since": "since",
    "--limit": "limit",
  };
  for (const [flag, q] of Object.entries(map)) {
    const v = val(flag);
    if (v != null) params.set(q, v);
  }
  const headers: Record<string, string> = {};
  const grantPath = val("--grant");
  if (grantPath) {
    if (!existsSync(grantPath)) {
      console.error(`feed: grant not found: ${grantPath}`);
      process.exit(1);
    }
    headers["x-brainblast-grant"] = Buffer.from(readFileSync(grantPath, "utf8")).toString("base64");
  }
  const url = `${base}/feed${params.toString() ? `?${params}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (e: any) {
    console.error(`feed: could not reach ${url}: ${e?.message ?? e}`);
    process.exit(1);
  }
  const body = await res.text();
  if (res.status !== 200) {
    console.error(`feed: server returned ${res.status}: ${body.trim()}`);
    process.exit(1);
  }
  process.stdout.write(body.endsWith("\n") ? body : body + "\n");
}

async function runFeed(argv: string[]): Promise<void> {
  const { selectFeed, tierForBrain, TIER_ENTITLEMENTS } = await import("./feed.ts");
  const { resolveLotPaths, readLots } = await import("./feedLots.ts");
  const { TRAP_CLASSES } = await import("./vtiClass.ts");

  if (argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast feed [--lot FILE]... [filters] [--tier T | --wallet-tier]");
    console.error("  Stream the delta of verified trap instances (VTIs) as NDJSON — one record per");
    console.error("  line — each carrying its RED→GREEN reproducibility receipt. Resume with --since.");
    console.error("");
    console.error("  --lot FILE              a .jsonl VTI lot (repeatable). Default: datasets/seed +");
    console.error("                         datasets/contrib if present.");
    console.error("  --since CURSOR          only records newer than this capturedAt cursor (the delta)");
    console.error("  --sdk SUBSTR            filter by SDK name (case-insensitive substring)");
    console.error("  --class CLASS           filter by trap class");
    console.error("  --severity LEVEL        minimum severity (critical|high|medium|low) and above");
    console.error("  --min-corroboration N   minimum distinct-repo corroboration");
    console.error("  --limit N               cap records (further bounded by the tier)");
    console.error("  --tier T                sample | standard | firehose (explicit)");
    console.error("  --wallet-tier           compute the tier from the active wallet's $BRAIN  [network]");
    console.error("  --grant FILE            serve the tier/lots from a SIGNED grant (enforced entitlement);");
    console.error("                         meters the pull to the ledger. ed25519 grants verify with");
    console.error("                         --pubkey/BRAINBLAST_MARKET_PUBKEY; legacy hmac needs the secret");
    console.error("  --pubkey ADDR           trusted distributor address for verifying an ed25519 --grant");
    console.error("  --remote URL            pull from a hosted endpoint (brainblast serve) instead of local");
    console.error("                         lots; sends --grant as a header, streams the entitled NDJSON");
    console.error("  --ledger FILE           usage-ledger path for --grant pulls (default datasets/usage-ledger.jsonl)");
    console.error("  --summary               print only the feed_meta line (no records)");
    console.error("");
    console.error("  Tiers gate the trainable payload + freshness: sample = metadata + receipt only");
    console.error("  (the proof), paid tiers unlock fixtures + the fresh delta. Tier eligibility from");
    console.error("  $BRAIN is advisory/client-side; real entitlement is enforced at distribution.");
    process.exit(2);
  }

  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const allVals = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
    return out;
  };

  // --remote <url>: become a CLIENT of a hosted endpoint (R3). The lots live on
  // the server; we send our grant and stream back only what it entitles. This is
  // the "local CLI becomes a client" half of the honest client/server split.
  const remote = val("--remote");
  if (remote) {
    await feedFromRemote(remote, argv, val);
    process.exit(0);
  }

  // Resolve lots: explicit --lot wins; else the repo's default lots if present.
  let lotPaths = resolveLotPaths(allVals("--lot"));

  // --grant <file>: enforce a verified entitlement at distribution. When present
  // the served tier (and lot scope) come from the SIGNED grant, not a self-
  // asserted --tier — this is the honesty gap the feed comments flagged. Every
  // grant-backed pull is metered to the usage ledger.
  const grantPath = val("--grant");
  let verifiedGrant: import("./marketplace.ts").Grant | undefined;
  if (grantPath) {
    const { verifyGrant } = await import("./marketplace.ts");
    if (!existsSync(grantPath)) {
      console.error(`feed: grant not found: ${grantPath}`);
      process.exit(1);
    }
    let parsed: import("./marketplace.ts").Grant;
    try {
      parsed = JSON.parse(readFileSync(grantPath, "utf8"));
    } catch {
      console.error(`feed: malformed grant file: ${grantPath}`);
      process.exit(2);
    }
    // ed25519 grants verify with only the trusted distributor pubkey (no secret);
    // legacy hmac grants need the shared secret. Mirrors `grant verify`.
    const verifier = resolveGrantVerifier(parsed, val("--pubkey"), val("--secret"));
    if (!verifier) process.exit(2);
    const v = verifyGrant(parsed, verifier, val("--now"));
    if (!v.valid) {
      console.error(`feed: grant rejected (${v.reason}) — not entitled`);
      process.exit(1);
    }
    verifiedGrant = parsed;
    // Lot scope: if the grant names lots, restrict the served lots to those.
    if (Array.isArray(parsed.lots) && parsed.lots.length) {
      lotPaths = lotPaths.filter((p) => parsed.lots.includes(p.split("/").pop() ?? p));
    }
  }

  if (lotPaths.length === 0) {
    console.error("feed: no VTI lots found. Pass --lot <file.jsonl> (a lot you received), or run from a repo with datasets/.");
    process.exit(1);
  }
  const { vtis, errors } = readLots(lotPaths);
  for (const e of errors) console.error(`feed: ${e}`);

  // Validate the class filter.
  const cls = val("--class");
  if (cls && !(TRAP_CLASSES as readonly string[]).includes(cls)) {
    console.error(`feed: unknown class "${cls}". One of: ${TRAP_CLASSES.join(", ")}`);
    process.exit(2);
  }
  const sev = val("--severity");
  if (sev && !["critical", "high", "medium", "low"].includes(sev)) {
    console.error(`feed: --severity must be critical|high|medium|low`);
    process.exit(2);
  }

  // Determine the tier: a verified grant wins (entitlement) → explicit override
  // → wallet-derived → sample default.
  let tier: FeedTier = "sample";
  const tierArg = val("--tier");
  if (verifiedGrant) {
    tier = verifiedGrant.tier;
  } else if (tierArg) {
    if (!["sample", "standard", "firehose"].includes(tierArg)) {
      console.error(`feed: --tier must be sample|standard|firehose`);
      process.exit(2);
    }
    tier = tierArg as FeedTier;
  } else if (argv.includes("--wallet-tier")) {
    const w = await import("./wallet/agentWallet.ts");
    const active = w.getActiveWallet();
    if (!active) {
      console.error("feed: --wallet-tier needs an active wallet (run `brainblast wallet init`)");
      process.exit(1);
    }
    const { getBalances } = await import("./wallet/chain.ts");
    try {
      const bal = await getBalances(active.pubkey);
      tier = tierForBrain(bal.brain.uiAmount);
    } catch (e: any) {
      console.error(`feed: could not read wallet balance: ${e?.message ?? e}`);
      process.exit(1);
    }
  }

  const query: FeedQuery = {
    sdk: val("--sdk"),
    class: cls as any,
    minSeverity: sev as any,
    minCorroboration: val("--min-corroboration") != null ? Number(val("--min-corroboration")) : undefined,
    since: val("--since"),
    limit: val("--limit") != null ? Number(val("--limit")) : undefined,
    now: val("--now"),
  };

  const result = selectFeed(vtis, query, tier);
  const ent = TIER_ENTITLEMENTS[tier];

  // NDJSON: a meta header, then one record per line, then a completion event
  // carrying the resume cursor — the same tail-the-stdout contract as `watch`.
  console.log(
    JSON.stringify({
      type: "feed_meta",
      tier,
      entitlement: { maxRecords: ent.maxRecords, includeFixtures: ent.includeFixtures, freshnessHoldbackHours: ent.freshnessHoldbackHours },
      lots: lotPaths,
      query: { sdk: query.sdk, class: query.class, minSeverity: query.minSeverity, minCorroboration: query.minCorroboration, since: query.since },
    }),
  );
  if (!argv.includes("--summary")) {
    for (const rec of result.records) console.log(JSON.stringify({ type: "vti", ...rec }));
  }
  console.log(JSON.stringify({ type: "feed_complete", cursor: result.cursor, counts: result.counts }));

  // Meter the pull: a grant-backed delivery is accounted to the usage ledger
  // (hash-chained, tamper-evident). This is the per-buyer billing basis.
  if (verifiedGrant) {
    const { appendUsage, verifyLedger } = await import("./marketplace.ts");
    const ledgerPath = val("--ledger") ?? "datasets/usage-ledger.jsonl";
    const prior = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    const chk = verifyLedger(prior);
    if (!chk.valid) {
      console.error(`feed: usage ledger integrity broken (${chk.reason} at seq ${chk.brokenAt}); refusing to append`);
      process.exit(1);
    }
    const entry = appendUsage(prior, {
      ts: val("--now") ?? new Date().toISOString(),
      buyer: verifiedGrant.buyer,
      tier,
      lots: lotPaths.map((p) => p.split("/").pop() ?? p),
      recordsServed: result.records.length,
      cursor: result.cursor,
      query: { sdk: query.sdk, class: query.class, minSeverity: query.minSeverity },
    });
    mkdirSync(ledgerPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
    writeFileSync(ledgerPath, [...prior, entry].map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  process.exit(0);
}

// `catalog` — the storefront. Reads the lots you hold and emits a buyer-facing
// catalog (JSON to stdout, plus datasets/CATALOG.md): coverage, freshness, the
// tier/price ladder, and receipt-only teasers. This is what you hand a buyer.
async function runCatalog(argv: string[]): Promise<void> {
  const { buildCatalog, renderCatalogMd } = await import("./marketplace.ts");
  const { resolveLotPaths, readLots } = await import("./feedLots.ts");

  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const allVals = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
    return out;
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast catalog [--lot FILE]... [--json] [--out FILE]");
    console.error("  Emit the buyer-facing catalog for the VTI lots you hold: coverage by SDK/class/");
    console.error("  severity, quality, freshness, the tier/price ladder, and receipt-only teasers.");
    console.error("  --lot FILE   a .jsonl VTI lot (repeatable). Default: datasets/seed + datasets/contrib.");
    console.error("  --json       print the catalog JSON to stdout (default also writes CATALOG.md)");
    console.error("  --out FILE   markdown output path (default datasets/CATALOG.md)");
    process.exit(2);
  }

  const lotPaths = resolveLotPaths(allVals("--lot"));
  if (lotPaths.length === 0) {
    console.error("catalog: no VTI lots found. Pass --lot <file.jsonl>, or run from a repo with datasets/.");
    process.exit(1);
  }
  const { vtis, errors } = readLots(lotPaths);
  for (const e of errors) console.error(`catalog: ${e}`);

  const catalog = buildCatalog(vtis, { now: val("--now") });
  console.log(JSON.stringify(catalog, null, 2));

  if (!argv.includes("--json")) {
    const outPath = val("--out") ?? "datasets/CATALOG.md";
    const md = renderCatalogMd(catalog, lotPaths);
    mkdirSync(outPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
    writeFileSync(outPath, md);
    console.error(`catalog: wrote ${outPath}`);
  }
  process.exit(0);
}

// `grant` — issue / verify / list access grants. The local distribution gate:
// the issuer signs a grant (HMAC over the canonical payload) and the feed
// verifies it before serving the paid payload, so a buyer can't self-assert a
// tier. NOTE: HMAC means issuer == verifier (a self-hosted distributor) — see
// the honesty note in marketplace.ts.
// Read a distributor secret key from a file: accepts either the JSON keygen
// output ({ secretKey }) or a bare base58 secret on its own line.
function readDistributorSecret(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const raw = readFileSync(file, "utf8").trim();
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.secretKey === "string") return j.secretKey;
  } catch {
    /* not JSON — treat as a bare key */
  }
  return raw || undefined;
}

async function runGrant(argv: string[]): Promise<void> {
  const mp = await import("./marketplace.ts");
  const sub = argv[0];
  const rest = argv.slice(1);
  const val = (flag: string): string | undefined => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const allVals = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < rest.length; i++) if (rest[i] === flag && rest[i + 1]) out.push(rest[i + 1]);
    return out;
  };

  if (!sub || argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast grant <keygen|issue|verify> [opts]");
    console.error("  keygen [--out FILE]");
    console.error("         generate a distributor identity (ed25519). Publish the address; keep secretKey.");
    console.error("  issue  --buyer ID --tier T [--lot NAME]... [--ttl-days N] [--out FILE]");
    console.error("         sign an access grant. ed25519 (recommended): BRAINBLAST_MARKET_KEY=<secretKey>");
    console.error("         (or --key / --key-file). Legacy hmac: BRAINBLAST_MARKET_SECRET (or --secret).");
    console.error("  verify --grant FILE [--pubkey ADDR]");
    console.error("         ed25519 grants verify with ONLY the distributor address (BRAINBLAST_MARKET_PUBKEY");
    console.error("         or --pubkey) — no secret needed. Legacy hmac grants need the shared secret.");
    process.exit(2);
  }

  if (sub === "keygen") {
    const kp = mp.generateDistributorKeypair();
    const outPath = val("--out");
    if (outPath) {
      writeFileSync(outPath, JSON.stringify(kp, null, 2) + "\n");
      console.error(`grant: distributor keypair written to ${outPath} (contains the SECRET — protect it)`);
      console.log(JSON.stringify({ address: kp.address }, null, 2));
    } else {
      // No file: print the secret to stdout so it isn't lost, with a warning.
      console.log(JSON.stringify(kp, null, 2));
    }
    console.error(`grant: distributor address ${kp.address}`);
    console.error("grant: issue with  BRAINBLAST_MARKET_KEY=<secretKey>  ·  verifiers need only  BRAINBLAST_MARKET_PUBKEY=<address>");
    process.exit(0);
  }

  if (sub === "issue") {
    const buyer = val("--buyer");
    const tier = val("--tier") as FeedTier | undefined;
    if (!buyer || !tier || !["sample", "standard", "firehose"].includes(tier)) {
      console.error("grant issue: --buyer ID and --tier sample|standard|firehose are required");
      process.exit(2);
    }
    const keyFile = val("--key-file");
    const edKey = process.env.BRAINBLAST_MARKET_KEY ?? val("--key") ?? (keyFile ? readDistributorSecret(keyFile) : undefined);
    const secret = process.env.BRAINBLAST_MARKET_SECRET ?? val("--secret");
    let signer: import("./marketplace.ts").GrantSigner;
    if (edKey) {
      signer = { alg: "ed25519", secretKey: edKey };
    } else if (secret) {
      signer = { alg: "hmac-sha256", secret };
    } else {
      console.error("grant issue: needs a signing key — BRAINBLAST_MARKET_KEY (ed25519, recommended; run `brainblast grant keygen`) or BRAINBLAST_MARKET_SECRET (legacy hmac)");
      process.exit(2);
    }
    const ttlRaw = val("--ttl-days");
    let grant: import("./marketplace.ts").Grant;
    try {
      grant = mp.issueGrant({ buyer, tier, lots: allVals("--lot"), signer, ttlDays: ttlRaw != null ? Number(ttlRaw) : null, now: val("--now") });
    } catch (e: any) {
      console.error(`grant issue: bad signing key (${e?.message ?? e})`);
      process.exit(2);
    }
    const out = JSON.stringify(grant, null, 2);
    const outPath = val("--out");
    if (outPath) {
      writeFileSync(outPath, out + "\n");
      console.error(`grant: issued ${tier} grant for ${buyer} → ${outPath}`);
    } else {
      console.log(out);
    }
    if (grant.alg === "ed25519") console.error(`grant: verify with  --pubkey ${grant.signer}  (or BRAINBLAST_MARKET_PUBKEY)`);
    process.exit(0);
  }

  if (sub === "verify") {
    const gp = val("--grant");
    if (!gp || !existsSync(gp)) {
      console.error("grant verify: --grant FILE is required and must exist");
      process.exit(2);
    }
    let parsed: import("./marketplace.ts").Grant;
    try {
      parsed = JSON.parse(readFileSync(gp, "utf8"));
    } catch {
      console.error("grant verify: malformed grant file");
      process.exit(2);
    }
    const verifier = resolveGrantVerifier(parsed, val("--pubkey"), val("--secret"));
    if (!verifier) process.exit(2);
    const v = mp.verifyGrant(parsed, verifier, val("--now"));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.valid ? 0 : 1);
  }

  console.error(`grant: unknown subcommand "${sub}"`);
  process.exit(2);
}

// Build the verifier for a grant from its own `alg`, drawing the trust root from
// flags/env. ed25519 needs ONLY the trusted distributor address (never defaults
// to the grant's own `signer` — that would let any self-signed grant pass);
// legacy hmac needs the shared secret. Prints the precise error and returns
// undefined when the needed material is missing.
function resolveGrantVerifier(
  grant: import("./marketplace.ts").Grant,
  pubkeyFlag: string | undefined,
  secretFlag: string | undefined,
): import("./marketplace.ts").GrantVerifier | undefined {
  const alg = grant.alg ?? "hmac-sha256";
  if (alg === "ed25519") {
    const pub = process.env.BRAINBLAST_MARKET_PUBKEY ?? pubkeyFlag;
    if (!pub) {
      console.error("grant: ed25519 grant needs the TRUSTED distributor address — --pubkey ADDR or BRAINBLAST_MARKET_PUBKEY");
      return undefined;
    }
    return { alg: "ed25519", publicKey: pub };
  }
  const secret = process.env.BRAINBLAST_MARKET_SECRET ?? secretFlag;
  if (!secret) {
    console.error("grant: legacy hmac grant needs the shared secret — BRAINBLAST_MARKET_SECRET or --secret");
    return undefined;
  }
  return { alg: "hmac-sha256", secret };
}

// `usage` — read the metering ledger: verify its hash-chain integrity and print a
// per-buyer summary (or the raw entries). The accounting basis for billing.
async function runUsage(argv: string[]): Promise<void> {
  const { verifyLedger, summarizeUsage } = await import("./marketplace.ts");
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast usage [--ledger FILE] [--json] [--verify]");
    console.error("  Summarize per-buyer usage from the metering ledger and verify its hash-chain.");
    console.error("  --ledger FILE   ledger path (default datasets/usage-ledger.jsonl)");
    console.error("  --json          print the per-buyer summary as JSON");
    console.error("  --verify        only check chain integrity; exit non-zero if broken");
    process.exit(2);
  }

  const ledgerPath = val("--ledger") ?? "datasets/usage-ledger.jsonl";
  if (!existsSync(ledgerPath)) {
    console.error(`usage: no ledger at ${ledgerPath} (no grant-backed pulls recorded yet)`);
    process.exit(argv.includes("--verify") ? 0 : 1);
  }
  const entries = readFileSync(ledgerPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const chk = verifyLedger(entries);
  if (!chk.valid) {
    console.error(`usage: LEDGER INTEGRITY BROKEN — ${chk.reason} at seq ${chk.brokenAt}`);
    process.exit(1);
  }
  if (argv.includes("--verify")) {
    console.error(`usage: ledger intact (${entries.length} entries, chain verified)`);
    process.exit(0);
  }

  const summary = summarizeUsage(entries);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ entries: entries.length, integrity: "ok", buyers: summary }, null, 2));
    process.exit(0);
  }
  console.log(`Usage ledger: ${entries.length} entries, hash-chain verified.\n`);
  console.log("Buyer                          Pulls  Records  Tiers              Last seen");
  console.log("-".repeat(80));
  for (const u of summary) {
    console.log(
      `${u.buyer.padEnd(30).slice(0, 30)} ${String(u.pulls).padStart(5)}  ${String(u.recordsServed).padStart(7)}  ${u.tiers.join(",").padEnd(18).slice(0, 18)} ${u.lastSeen}`,
    );
  }
  process.exit(0);
}

// `serve` — the hosted distribution endpoint (R3). A zero-dep node:http server
// that holds the full lots and enforces entitlement at distribution: public
// catalog + anonymous sample feed, ed25519/hmac-grant-gated paid feed, with an
// authoritative server-side hash-chained usage ledger. Returns a never-resolving
// promise while listening (resolves on SIGINT/SIGTERM for a clean shutdown).
async function runServe(argv: string[]): Promise<void> {
  const http = await import("node:http");
  const { handleRequest } = await import("./server.ts");
  const { resolveLotPaths, readLots } = await import("./feedLots.ts");
  const { appendUsage, verifyLedger } = await import("./marketplace.ts");

  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const allVals = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
    return out;
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: brainblast serve [--port N] [--lot FILE]... [--pubkey ADDR] [--ledger FILE]");
    console.error("  Host the distribution endpoint: the server holds the full lots and enforces");
    console.error("  entitlement at distribution. Routes:");
    console.error("    GET /healthz   liveness");
    console.error("    GET /catalog   the storefront — PUBLIC + anonymous (no grant)");
    console.error("    GET /feed      anonymous → sample tier; with a grant header → the entitled tier");
    console.error("                   query: ?sdk=&class=&severity=&min_corroboration=&since=&limit=");
    console.error("                   grant header: 'x-brainblast-grant: <base64 grant JSON>'");
    console.error("  --port N        listen port (default 8787)");
    console.error("  --lot FILE      a VTI lot to serve (repeatable). Default: datasets/seed + contrib.");
    console.error("  --pubkey ADDR   trusted distributor ed25519 address (or BRAINBLAST_MARKET_PUBKEY)");
    console.error("                  — verifies ed25519 grants with NO shared secret (R2).");
    console.error("  --secret S      legacy hmac secret (or BRAINBLAST_MARKET_SECRET)");
    console.error("  --ledger FILE   authoritative usage ledger (default datasets/usage-ledger.jsonl)");
    process.exit(2);
  }

  const port = Number(val("--port") ?? 8787);
  const lotPaths = resolveLotPaths(allVals("--lot"));
  if (lotPaths.length === 0) {
    console.error("serve: no VTI lots found. Pass --lot <file.jsonl>, or run from a repo with datasets/.");
    process.exit(1);
  }
  // Load each lot separately so a grant's lot-scope can be enforced by name.
  const lots: Array<{ name: string; vtis: any[] }> = [];
  for (const p of lotPaths) {
    const { vtis, errors } = readLots([p]);
    for (const e of errors) console.error(`serve: ${e}`);
    lots.push({ name: p.split("/").pop() ?? p, vtis });
  }

  const trustedDistributor = process.env.BRAINBLAST_MARKET_PUBKEY ?? val("--pubkey");
  const hmacSecret = process.env.BRAINBLAST_MARKET_SECRET ?? val("--secret");
  const ledgerPath = val("--ledger") ?? "datasets/usage-ledger.jsonl";

  // The authoritative meter: append to the hash-chained ledger, fail-closed on a
  // broken chain (the same integrity gate the local feed uses).
  const meter = (rec: any): void => {
    const prior = existsSync(ledgerPath)
      ? readFileSync(ledgerPath, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))
      : [];
    const chk = verifyLedger(prior);
    if (!chk.valid) throw new Error(`ledger integrity broken (${chk.reason} at seq ${chk.brokenAt})`);
    const entry = appendUsage(prior, rec);
    mkdirSync(ledgerPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
    writeFileSync(ledgerPath, [...prior, entry].map((e) => JSON.stringify(e)).join("\n") + "\n");
  };

  const totalVtis = lots.reduce((n, l) => n + l.vtis.length, 0);
  const server = http.createServer((httpReq, httpRes) => {
    const url = new URL(httpReq.url ?? "/", `http://localhost:${port}`);
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    // Grant header (base64 of the grant JSON) → parsed grant for the handler.
    let grant: any;
    const hdr = httpReq.headers["x-brainblast-grant"];
    if (typeof hdr === "string" && hdr.length) {
      try {
        grant = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
      } catch {
        httpRes.writeHead(400, { "content-type": "application/json" });
        httpRes.end(JSON.stringify({ error: "malformed x-brainblast-grant header (expect base64 JSON)" }));
        return;
      }
    }

    let resp;
    try {
      resp = handleRequest({ method: httpReq.method ?? "GET", path: url.pathname, query, grant }, { lots, trustedDistributor, hmacSecret, meter });
    } catch (e: any) {
      resp = { status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal", detail: e?.message ?? String(e) }) };
    }
    console.error(`serve: ${httpReq.method} ${url.pathname}${url.search} → ${resp.status}`);
    httpRes.writeHead(resp.status, { "content-type": resp.contentType });
    httpRes.end(resp.body);
  });

  return await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.error(`brainblast serve: listening on http://localhost:${port}`);
      console.error(`  lots: ${lots.map((l) => `${l.name}(${l.vtis.length})`).join(", ")} · ${totalVtis} VTIs`);
      console.error(`  trust: ${trustedDistributor ? `ed25519 ${trustedDistributor}` : hmacSecret ? "hmac (legacy)" : "NONE — only anonymous sample + catalog will work"}`);
      console.error(`  ledger: ${ledgerPath}`);
    });
    const shutdown = () => {
      console.error("\nserve: shutting down");
      server.close(() => resolve());
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

async function runWallet(argv: string[]): Promise<void> {
  const w = await import("./wallet/agentWallet.ts");
  const sub = argv[0];
  const rest = argv.slice(1);
  const requireAddress = (addr: string | undefined, what: string): string => {
    if (!addr || !isValidSolanaAddress(addr)) {
      console.error(`wallet: ${what} "${addr ?? ""}" is not a valid Solana address.`);
      process.exit(2);
    }
    return addr;
  };

  if (!sub || sub === "--help" || sub === "-h") {
    console.error("usage: brainblast wallet <command>");
    console.error("  init [--label NAME] [--owner ADDR]  generate a capped agent ops wallet into the Vault");
    console.error("  address                             print the active wallet's pubkey (for funding)");
    console.error("  list                                list known agent wallets (never secrets)");
    console.error("  balance                             SOL / $BRAIN / $USDC vs caps + session budget  [network]");
    console.error("  policy                              show the spend policy governing this wallet");
    console.error("  config --owner ADDR | --max-usd-per-tx N | --max-usd-per-session N |");
    console.error("         --max-brain-per-tx N | --max-brain-per-session N");
    console.error("  stake --pack-id ID --rule-id ID --stake-usd N --brain-amount N   bond a VTI  [network]");
    console.error("  sweep <to>                          drain everything to an owner address — panic button  [network]");
    console.error("  rotate [--label NAME]               new key, sweep old → new, re-Vault  [network]");
    console.error("  delegate --owner ADDR --token brain|usdc --amount N   Tier-2: emit owner `approve`");
    console.error("  revoke [--owner ADDR --token brain|usdc]             Tier-2 revoke / Tier-1 disable spend");
    console.error("");
    console.error("  The secret lives ONLY in the encrypted Vault (~/.brainblast/vault), recoverable by");
    console.error("  pubkey. This is a SMALL, CAPPED, SACRIFICIAL wallet — never your main holdings. Every");
    console.error("  outbound tx passes the spend policy (caps + recipient allowlist) before it is signed.");
    process.exit(2);
  }

  if (sub === "init") {
    const labelIdx = rest.indexOf("--label");
    const label = labelIdx >= 0 ? rest[labelIdx + 1] : undefined;
    const existing = w.getActiveWallet();
    if (existing && !rest.includes("--force")) {
      console.error(`wallet: an active wallet already exists (${existing.pubkey}).`);
      console.error("Run `brainblast wallet address` to see it, or pass --force to generate another.");
      process.exit(1);
    }
    const ownerIdx = rest.indexOf("--owner");
    const owner = ownerIdx >= 0 ? rest[ownerIdx + 1] : undefined;
    if (owner) requireAddress(owner, "owner address");
    const gen = w.createWallet({ label });
    if (owner) {
      const { addOwnerSweepAddress } = await import("./wallet/policy.ts");
      addOwnerSweepAddress(owner);
    }
    console.log(`✓ agent wallet created\n`);
    console.log(`  pubkey:  ${gen.pubkey}`);
    console.log(`  stored:  encrypted in the Vault (~/.brainblast/vault), recoverable by pubkey`);
    if (owner) console.log(`  owner:   ${owner}  (registered sweep target)`);
    console.log("");
    console.log("  ── ONE-TIME SECRET BACKUP (shown once — save it somewhere safe) ──");
    console.log("  This is a solana-keygen id.json array; `solana` can import it directly.");
    console.log(`  ${JSON.stringify(gen.secretKeyArray)}\n`);
    console.log("  ⚠ This is a SMALL, CAPPED, SACRIFICIAL ops wallet — fund it with only what an");
    console.log("    agent may spend (e.g. $20–50 of SOL/$BRAIN). Never your main holdings.");
    console.log(`  Fund it by sending SOL/$BRAIN/$USDC to the pubkey above.`);
    if (!owner) {
      console.log(`  Set your sweep (panic-button) address: brainblast wallet config --owner <addr>`);
    }
    process.exit(0);
  }

  if (sub === "address") {
    const active = w.getActiveWallet();
    if (!active) {
      console.error("wallet: no active wallet. Run `brainblast wallet init` first.");
      process.exit(1);
    }
    const recoverable = w.isRecoverable(active.pubkey);
    console.log(active.pubkey);
    if (!recoverable) {
      console.error(`⚠ warning: this wallet is NOT recoverable from the Vault — the secret may be lost.`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (sub === "list") {
    const wallets = w.listWallets();
    if (wallets.length === 0) {
      console.log("No agent wallets. Run `brainblast wallet init` to create one.");
      process.exit(0);
    }
    const active = w.getActiveWallet();
    for (const rec of wallets) {
      const mark = active && rec.pubkey === active.pubkey ? "*" : " ";
      const rec_ok = w.isRecoverable(rec.pubkey) ? "" : "  ⚠ not recoverable";
      console.log(`${mark} ${rec.pubkey}  ${rec.tier}  ${rec.createdAt}${rec.label ? `  (${rec.label})` : ""}${rec_ok}`);
    }
    process.exit(0);
  }

  if (sub === "policy") {
    const { loadWalletPolicy, readSessionSpend, readSessionBrain } = await import("./wallet/policy.ts");
    const { policy, source } = loadWalletPolicy();
    console.log(`spend policy  (${source})`);
    console.log(`  per-tx cap:        $${policy.maxUsdPerTx}`);
    console.log(`  per-session cap:   $${policy.maxUsdPerSession}  (spent this session: $${readSessionSpend().toFixed(2)})`);
    console.log(`  $BRAIN per-tx:     ${policy.maxBrainPerTx ?? "(none — autonomous $BRAIN spend disabled)"}`);
    console.log(`  $BRAIN per-session:${policy.maxBrainPerSession != null ? " " + policy.maxBrainPerSession : " (none)"}  (spent this session: ${readSessionBrain()})`);
    console.log(`  per-tx SOL cap:    ${policy.maxSolPerTx ?? "none"}`);
    console.log(`  owner sweep addrs: ${policy.ownerSweepAddresses.length ? policy.ownerSweepAddresses.join(", ") : "(none — set one with `wallet config --owner <addr>`)"}`);
    console.log(`  allowed recipients:${policy.allowedRecipients.length ? " " + policy.allowedRecipients.join(", ") : " (any, capped)"}`);
    console.log(`  block unknown programs: ${policy.blockUnknownPrograms}`);
    process.exit(0);
  }

  if (sub === "config") {
    const { loadWalletPolicy, saveWalletPolicy, addOwnerSweepAddress } = await import("./wallet/policy.ts");
    const val = (flag: string): string | undefined => {
      const i = rest.indexOf(flag);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    let changed = false;
    const owner = val("--owner");
    if (owner) {
      requireAddress(owner, "owner address");
      addOwnerSweepAddress(owner);
      console.log(`✓ registered owner sweep address: ${owner}`);
      changed = true;
    }
    const perTx = val("--max-usd-per-tx");
    const perSession = val("--max-usd-per-session");
    const brainTx = val("--max-brain-per-tx");
    const brainSession = val("--max-brain-per-session");
    if (perTx || perSession || brainTx || brainSession) {
      const { policy } = loadWalletPolicy();
      if (perTx) policy.maxUsdPerTx = Number(perTx);
      if (perSession) policy.maxUsdPerSession = Number(perSession);
      if (brainTx) policy.maxBrainPerTx = Number(brainTx);
      if (brainSession) policy.maxBrainPerSession = Number(brainSession);
      saveWalletPolicy(policy);
      console.log(`✓ caps updated: per-tx $${policy.maxUsdPerTx}, per-session $${policy.maxUsdPerSession}`);
      if (brainTx || brainSession)
        console.log(`  $BRAIN caps: per-tx ${policy.maxBrainPerTx ?? "(none)"}, per-session ${policy.maxBrainPerSession ?? "(none)"}`);
      changed = true;
    }
    if (!changed) {
      console.error("config: nothing to do. Pass --owner ADDR, --max-usd-per-tx N, --max-usd-per-session N,");
      console.error("        --max-brain-per-tx N, or --max-brain-per-session N.");
      process.exit(2);
    }
    process.exit(0);
  }

  if (sub === "balance") {
    const active = w.getActiveWallet();
    if (!active) {
      console.error("wallet: no active wallet. Run `brainblast wallet init` first.");
      process.exit(1);
    }
    const { getBalances } = await import("./wallet/chain.ts");
    const { loadWalletPolicy } = await import("./wallet/policy.ts");
    try {
      const b = await getBalances(active.pubkey);
      console.log(`${active.pubkey}`);
      console.log(`  SOL:    ${b.sol}`);
      console.log(`  $BRAIN: ${b.brain.uiAmount}`);
      console.log(`  USDC:   ${b.usdc.uiAmount}`);
      const { policy } = loadWalletPolicy();
      // If holdings dwarf the session cap, the wallet is over-funded for an ops
      // wallet — nudge the user to sweep the excess.
      if (b.usdc.uiAmount > policy.maxUsdPerSession * 4) {
        console.log(`  ⚠ this wallet holds more than 4× the session cap ($${policy.maxUsdPerSession}). It is meant`);
        console.log(`    to be small + sacrificial — consider sweeping the excess: brainblast wallet sweep <owner>`);
      }
      process.exit(0);
    } catch (e: any) {
      console.error(`wallet balance: ${e?.message ?? String(e)}`);
      process.exit(1);
    }
  }

  if (sub === "stake") {
    const val = (flag: string): string | undefined => {
      const i = rest.indexOf(flag);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    const packId = val("--pack-id");
    const ruleId = val("--rule-id");
    const stakeUsd = Number(val("--stake-usd"));
    const brainAmount = Number(val("--brain-amount"));
    if (!packId || !ruleId || !Number.isFinite(stakeUsd) || !Number.isFinite(brainAmount)) {
      console.error("usage: brainblast wallet stake --pack-id ID --rule-id ID --stake-usd N --brain-amount N");
      process.exit(2);
    }
    const { stakeBond } = await import("./wallet/stake.ts");
    try {
      const r = await stakeBond({ packId, ruleId, stakeUsd, brainAmount });
      if (!r.ok) {
        console.error(`✗ refused by spend policy (${r.decision.policySource}):`);
        for (const v of r.decision.violations) console.error(`  - ${v}`);
        process.exit(1);
      }
      console.log(`✓ staked $${stakeUsd} (${brainAmount} $BRAIN) on ${packId}/${ruleId}`);
      console.log(`  stake:  ${r.stakeId}  memo ${r.memoCode}  →  ${r.payTo}`);
      console.log(`  tx:     ${r.signature}`);
      process.exit(0);
    } catch (e: any) {
      console.error(`wallet stake: ${e?.message ?? String(e)}`);
      process.exit(1);
    }
  }

  if (sub === "sweep") {
    const to = rest.find((a) => !a.startsWith("--"));
    if (!to) {
      console.error("usage: brainblast wallet sweep <owner-address>");
      process.exit(2);
    }
    requireAddress(to, "sweep target");
    const active = w.getActiveWallet();
    if (!active) {
      console.error("wallet: no active wallet.");
      process.exit(1);
    }
    const { signWithPolicy } = await import("./wallet/policy.ts");
    const { sweepAll } = await import("./wallet/chain.ts");
    const secret = w.loadSecretKey(active.pubkey);
    let movedSol = 0;
    let sigs: string[] = [];
    const result = await signWithPolicy({ purpose: "sweep", recipient: to, usd: 0 }, async () => {
      const r = await sweepAll(secret, to);
      movedSol = r.movedSol;
      sigs = r.signatures;
      return r.signatures[r.signatures.length - 1] ?? "(nothing to move)";
    });
    if (!result.ok) {
      console.error(`✗ sweep refused by spend policy (${result.decision.policySource}):`);
      for (const v of result.decision.violations) console.error(`  - ${v}`);
      process.exit(1);
    }
    console.log(`✓ swept ${active.pubkey} → ${to}`);
    console.log(`  moved ~${movedSol} SOL + all $BRAIN/USDC in ${sigs.length} tx`);
    for (const s of sigs) console.log(`  tx: ${s}`);
    process.exit(0);
  }

  if (sub === "rotate") {
    const labelIdx = rest.indexOf("--label");
    const label = labelIdx >= 0 ? rest[labelIdx + 1] : undefined;
    const { sweepAll } = await import("./wallet/chain.ts");
    try {
      const { oldPubkey, oldSecret, newWallet } = w.rotateWallet({ label });
      console.log(`✓ new active wallet: ${newWallet.pubkey}`);
      console.log(`  ── ONE-TIME SECRET BACKUP (save it) ──`);
      console.log(`  ${JSON.stringify(newWallet.secretKeyArray)}`);
      console.log(`  sweeping old wallet ${oldPubkey} → new...`);
      const r = await sweepAll(oldSecret, newWallet.pubkey);
      console.log(`  moved ~${r.movedSol} SOL + tokens in ${r.signatures.length} tx`);
      console.log(`  (old key remains recoverable in the Vault)`);
      process.exit(0);
    } catch (e: any) {
      console.error(`wallet rotate: ${e?.message ?? String(e)}`);
      process.exit(1);
    }
  }

  if (sub === "delegate") {
    const val = (flag: string): string | undefined => {
      const i = rest.indexOf(flag);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    const owner = val("--owner");
    const token = val("--token") ?? "brain";
    const amount = Number(val("--amount"));
    const active = w.getActiveWallet();
    if (!active) {
      console.error("wallet: no active wallet. Run `brainblast wallet init` first.");
      process.exit(1);
    }
    if (!owner || !Number.isFinite(amount)) {
      console.error("usage: brainblast wallet delegate --owner ADDR --token brain|usdc --amount N");
      process.exit(2);
    }
    requireAddress(owner, "owner address");
    const { buildDelegateInstructions } = await import("./wallet/delegate.ts");
    const d = await buildDelegateInstructions({ ownerPubkey: owner, agentPubkey: active.pubkey, token, uiAmount: amount });
    // Mark the active wallet as Tier-2 (delegated) — it now spends an allowance,
    // not its own principal.
    try {
      w.setActiveWallet(active.pubkey);
    } catch {
      /* manifest already consistent */
    }
    console.log(`Tier-2 delegation — run this from YOUR wallet (the one holding the ${d.label}):\n`);
    console.log(`  ${d.approveCommand}\n`);
    console.log(`  owner token account: ${d.ownerTokenAccount}`);
    console.log(`  delegate (agent):    ${d.delegate}`);
    console.log(`  allowance:           ${d.uiAmount} ${d.label}\n`);
    console.log(`  ${d.note}`);
    process.exit(0);
  }

  if (sub === "revoke") {
    const val = (flag: string): string | undefined => {
      const i = rest.indexOf(flag);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    const owner = val("--owner");
    const token = val("--token") ?? "brain";
    if (owner) {
      requireAddress(owner, "owner address");
      // Tier-2: emit the on-chain revoke for the owner to run.
      const { buildRevokeInstructions } = await import("./wallet/delegate.ts");
      const r = await buildRevokeInstructions({ ownerPubkey: owner, token });
      console.log(`Tier-2 revoke — run this from YOUR wallet:\n`);
      console.log(`  ${r.revokeCommand}\n`);
      console.log(`  This cancels the agent's delegated allowance on ${r.ownerTokenAccount} on-chain.`);
      process.exit(0);
    }
    // Tier-1: disable autonomous spend by zeroing the session cap.
    const { loadWalletPolicy, saveWalletPolicy } = await import("./wallet/policy.ts");
    const { policy } = loadWalletPolicy();
    policy.maxUsdPerSession = 0;
    policy.maxUsdPerTx = 0;
    saveWalletPolicy(policy);
    console.log("✓ autonomous spend disabled (caps set to $0). Raise them with `wallet config` to re-enable.");
    console.log("  Sweep is still available (it ignores spend caps) to recover funds.");
    process.exit(0);
  }

  console.error(`wallet: unknown subcommand "${sub}". Try \`brainblast wallet --help\`.`);
  process.exit(2);
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
