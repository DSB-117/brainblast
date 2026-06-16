// Upgrade risk diff — compares OSV advisory profiles between two versions.
//
//   brainblast diff lodash@4.17.20 lodash@4.17.21
//   brainblast diff stripe@12.0.0 stripe@13.0.0 --ecosystem npm
//   brainblast diff serde@1.0.0 serde@1.0.195 --ecosystem crates.io

import { queryOsv, type OsvAdvisory } from "./osv.ts";

export interface DiffResult {
  package: string;
  ecosystem: string;
  fromVersion: string;
  toVersion: string;
  /** Advisories present in fromVersion that are gone in toVersion. */
  resolved: OsvAdvisory[];
  /** Advisories that appear in toVersion but were not in fromVersion. */
  introduced: OsvAdvisory[];
  /** Advisories present in both versions. */
  unchanged: OsvAdvisory[];
}

export async function diffVersions(
  ecosystem: string,
  packageName: string,
  fromVersion: string,
  toVersion: string,
): Promise<DiffResult> {
  const [fromAdvisories, toAdvisories] = await Promise.all([
    queryOsv(ecosystem, packageName, fromVersion),
    queryOsv(ecosystem, packageName, toVersion),
  ]);

  const fromIds = new Set(fromAdvisories.map((a) => a.id));
  const toIds = new Set(toAdvisories.map((a) => a.id));

  return {
    package: packageName,
    ecosystem,
    fromVersion,
    toVersion,
    resolved: fromAdvisories.filter((a) => !toIds.has(a.id)),
    introduced: toAdvisories.filter((a) => !fromIds.has(a.id)),
    unchanged: fromAdvisories.filter((a) => toIds.has(a.id)),
  };
}

const SEV_WEIGHT: Record<string, number> = { critical: 8, high: 4, medium: 2, low: 1 };

export function riskScore(result: DiffResult): number {
  const sum = (list: OsvAdvisory[]) =>
    list.reduce((n, a) => n + (SEV_WEIGHT[a.severity] ?? 0), 0);
  return sum(result.introduced) - sum(result.resolved);
}

function badge(sev: string): string {
  return { critical: "[CRITICAL]", high: "[HIGH]", medium: "[MEDIUM]", low: "[LOW]" }[sev] ?? `[${sev.toUpperCase()}]`;
}

export function renderDiffText(result: DiffResult): string {
  const lines: string[] = [];
  lines.push(`brainblast diff: ${result.package} ${result.fromVersion} → ${result.toVersion} (${result.ecosystem})\n`);

  const total = result.introduced.length + result.resolved.length + result.unchanged.length;
  if (total === 0) {
    lines.push("  No known OSV advisories for either version.");
    return lines.join("\n");
  }

  if (result.introduced.length > 0) {
    lines.push(`  INTRODUCED (${result.introduced.length}):`);
    for (const a of result.introduced) {
      lines.push(`    + ${badge(a.severity)} ${a.id} — ${a.summary}`);
      lines.push(`      ${a.url}`);
    }
  }
  if (result.resolved.length > 0) {
    lines.push(`  RESOLVED (${result.resolved.length}):`);
    for (const a of result.resolved) {
      lines.push(`    - ${badge(a.severity)} ${a.id} — ${a.summary}`);
      lines.push(`      ${a.url}`);
    }
  }
  if (result.unchanged.length > 0) {
    lines.push(`  UNCHANGED (${result.unchanged.length}):`);
    for (const a of result.unchanged) {
      lines.push(`    ~ ${badge(a.severity)} ${a.id} — ${a.summary}`);
    }
  }

  return lines.join("\n");
}

export function renderDiffMd(result: DiffResult): string {
  const lines: string[] = [];
  lines.push(`## brainblast diff: \`${result.package}\` ${result.fromVersion} → ${result.toVersion} (${result.ecosystem})\n`);

  const total = result.introduced.length + result.resolved.length + result.unchanged.length;
  if (total === 0) {
    lines.push("No known OSV advisories for either version.");
    return lines.join("\n");
  }

  if (result.introduced.length > 0) {
    lines.push(`### ⚠️ Introduced (${result.introduced.length})\n`);
    for (const a of result.introduced) {
      lines.push(`- **${badge(a.severity)}** [${a.id}](${a.url}) — ${a.summary}`);
    }
    lines.push("");
  }
  if (result.resolved.length > 0) {
    lines.push(`### ✅ Resolved (${result.resolved.length})\n`);
    for (const a of result.resolved) {
      lines.push(`- **${badge(a.severity)}** [${a.id}](${a.url}) — ${a.summary}`);
    }
    lines.push("");
  }
  if (result.unchanged.length > 0) {
    lines.push(`### ~ Unchanged (${result.unchanged.length})\n`);
    for (const a of result.unchanged) {
      lines.push(`- **${badge(a.severity)}** [${a.id}](${a.url}) — ${a.summary}`);
    }
    lines.push("");
  }

  const score = riskScore(result);
  if (score > 0) {
    lines.push(`> **⛔ Upgrade increases risk (score +${score}). Review introduced advisories before bumping.**`);
  } else if (score < 0) {
    lines.push(`> **✅ Upgrade decreases risk (score ${score}). Upgrade recommended.**`);
  } else if (result.unchanged.length > 0) {
    lines.push(`> **~ Risk profile unchanged (${result.unchanged.length} advisory${result.unchanged.length !== 1 ? "ies" : ""} persist).**`);
  }

  return lines.join("\n");
}
