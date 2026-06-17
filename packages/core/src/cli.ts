#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.ts";
import { getChangedRanges } from "./gitDiff.ts";
import { loadMemory, saveMemory, updateMemory, precedentKey } from "./memory.ts";
import { resolveRules } from "./resolveRules.ts";
import { buildTrustGraph, renderTrustGraphMd, isValidSolanaAddress, cacheSize, loadProgramCache, defaultCachePath } from "./trustGraph/index.ts";
import { analyzeCosts, renderCostReportMd } from "./costAnalysis.ts";
import { startWatch } from "./watch.ts";
import { execFileSync } from "node:child_process";
import { applyDiffToFile, parseDiff } from "./fixers/applyDiff.ts";
import { initPack, validatePack } from "./pack.ts";
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
  return value.split(",").map((s) => s.trim()).filter(Boolean);
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

if (args[0] === "fix") {
  await runFix(args.slice(1));
  process.exit(0);
}

const ci = args.includes("--ci");
const strict = args.includes("--strict");
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;
const targetDir =
  args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--since") ?? process.cwd();

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

if (ci) {
  const gateFail = fails > 0 || (strict && cantTell > 0);
  process.exit(gateFail ? 1 : 0);
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
      const marker = r.status === "ok" ? "OK" : r.status === "missing-fixtures" ? "WARN" : "FAIL";
      console.log(`  [${marker}] ${r.ruleId}: ${r.detail}`);
    }
    process.exit(result.ok ? 0 : 1);
  }

  console.error("usage: brainblast pack <init|validate> ...");
  process.exit(2);
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
