#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./audit.ts";
import { resolveRules } from "./resolveRules.ts";
import { buildTrustGraph, renderTrustGraphMd, isValidSolanaAddress, cacheSize, loadProgramCache, defaultCachePath } from "./trustGraph/index.ts";
import { analyzeCosts, renderCostReportMd } from "./costAnalysis.ts";

// Usage:
//   brainblast <targetDir> [--ci] [--strict]
//   brainblast trust-graph <programId> [<programId>...] [--rpc URL] [--no-probe] [--json]
//
// `audit` runs every bundled rule (default). With --ci, a confirmed FAIL exits
// 1. CANT_TELL warns and does NOT fail unless --strict is passed.
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
const targetDir = args.find((a) => !a.startsWith("--")) ?? process.cwd();

const rules = resolveRules(targetDir);
const { checks, report } = audit(targetDir, rules);
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
