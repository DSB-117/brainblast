// HiveMind demand signal — the loop that makes the recursion demand-driven.
//
// The hive knows where agents on this machine ACTUALLY struggled: every
// experience event is a rule an agent shipped wrong and then fixed. Aggregated
// (counts only — no code, no paths beyond repo names, nothing identifying),
// that is exactly the signal the fleet's work-orders lack: not just "where is
// coverage thin" but "where do real agents fail most". `npm run corpus` folds
// a stats file into COVERAGE.md's work-orders when one is present, so scout
// effort flows toward observed failure, not guesses.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CorpusVti } from "../corpus.ts";
import type { ExperienceEvent } from "./experience.ts";

export interface DemandSignal {
  schemaVersion: "1.0";
  generatedAt?: string;
  totalFixEvents: number;
  repos: number; // distinct repos the events came from (breadth of the signal)
  byRule: Record<string, number>;
  byClass: Record<string, number>; // resolved via the hive lot's trapId → class
  bySdk: Record<string, number>; // resolved via the hive lot's trapId → sdk
  unresolvedRules: string[]; // fix events whose rule has no hive VTI (still counted byRule)
}

export function buildDemandSignal(experience: ExperienceEvent[], vtis: CorpusVti[], generatedAt?: string): DemandSignal {
  const byTrap = new Map<string, CorpusVti>();
  for (const v of vtis) if (!byTrap.has(v.trapId)) byTrap.set(v.trapId, v);

  const byRule: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  const bySdk: Record<string, number> = {};
  const repos = new Set<string>();
  const unresolved = new Set<string>();

  for (const e of experience) {
    repos.add(e.repoPath);
    byRule[e.ruleId] = (byRule[e.ruleId] ?? 0) + 1;
    const vti = byTrap.get(e.ruleId);
    if (vti) {
      byClass[vti.class] = (byClass[vti.class] ?? 0) + 1;
      const sdk = vti.sdk?.name ?? "unknown";
      bySdk[sdk] = (bySdk[sdk] ?? 0) + 1;
    } else {
      unresolved.add(e.ruleId);
    }
  }

  return {
    schemaVersion: "1.0",
    ...(generatedAt ? { generatedAt } : {}),
    totalFixEvents: experience.length,
    repos: repos.size,
    byRule,
    byClass,
    bySdk,
    unresolvedRules: [...unresolved].sort(),
  };
}

export function statsPath(root: string): string {
  return join(root, "stats.json");
}

export function writeDemandSignal(root: string, signal: DemandSignal): string {
  mkdirSync(root, { recursive: true });
  const p = statsPath(root);
  writeFileSync(p, JSON.stringify(signal, null, 2) + "\n");
  return p;
}

export function renderDemandText(d: DemandSignal): string {
  const lines: string[] = [];
  lines.push(`hive demand signal — ${d.totalFixEvents} fix event${d.totalFixEvents === 1 ? "" : "s"} across ${d.repos} repo${d.repos === 1 ? "" : "s"} (counts only, nothing identifying)`);
  const top = (rec: Record<string, number>, label: string) => {
    const entries = Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (entries.length) lines.push(`  ${label}: ${entries.map(([k, n]) => `${k} ×${n}`).join(", ")}`);
  };
  top(d.byRule, "rules  ");
  top(d.byClass, "classes");
  top(d.bySdk, "sdks   ");
  if (d.unresolvedRules.length) lines.push(`  (unresolved to class/sdk — no hive VTI on file: ${d.unresolvedRules.join(", ")})`);
  if (d.totalFixEvents === 0) lines.push("  (empty — audits promote fix events here as agents work)");
  return lines.join("\n");
}
