#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.ts";
import { getChangedRanges } from "./gitDiff.ts";
import { loadMemory, saveMemory, updateMemory, precedentKey } from "./memory.ts";
import { resolveRules } from "./resolveRules.ts";
import { buildTrustGraph, renderTrustGraphMd, isValidSolanaAddress, cacheSize, loadProgramCache, defaultCachePath } from "./trustGraph/index.ts";
import { analyzeCosts, renderCostReportMd } from "./costAnalysis.ts";

// Usage:
//   brainblast <targetDir> [--ci] [--strict] [--since <ref>]
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
// `trust-graph` resolves upgrade authority + verified-build status for each
// program id (Phase 1 of PLAN-solana-deep-dive.md). Reads the bundled program
// directory first, then the program cache (~/.brainblast/program-cache.json),
// and falls back to a live RPC probe for anything unknown. Pass --no-cache to
// skip the cache entirely (always re-probe from RPC).
const args = process.argv.slice(2);

if (args[0] === "trust-graph") {
  await runTrustGraph(args.slice(1));
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

const rules = resolveRules(targetDir);
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
