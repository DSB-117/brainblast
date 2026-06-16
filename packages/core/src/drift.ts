// Dependency drift alerting — detects new OSV advisories for pinned dependencies.
//
//   brainblast drift [dir] [--update-baseline] [--json]
//
// Reads every lockfile in the project via the same parser logic as
// seed-inventory.sh, queries OSV.dev in batch for all pinned packages, and
// compares the results against a stored baseline at
// .agent-research/drift-baseline.json.
//
// On first run (no baseline), it writes the baseline and exits 0.
// On subsequent runs, it exits 0 when nothing changed and 1 when new
// advisories have appeared since the baseline was written.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { OsvAdvisory } from "./osv.ts";

export interface DriftPackage {
  name: string;
  version: string;
  ecosystem: string;
  source: string;
}

export interface DriftAdvisory extends OsvAdvisory {
  package: string;
  ecosystem: string;
  version: string;
}

export interface DriftBaseline {
  createdAt: string;
  packages: number;
  /** Map from "ecosystem:name@version" to array of advisory IDs. */
  advisoryIds: Record<string, string[]>;
}

export interface DriftResult {
  newAdvisories: DriftAdvisory[];
  resolvedAdvisories: DriftAdvisory[];
  baselineExists: boolean;
  baselineDate: string | null;
  packagesChecked: number;
}

const BASELINE_PATH = (dir: string) =>
  join(dir, ".agent-research", "drift-baseline.json");

function pkgKey(pkg: DriftPackage) {
  return `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
}

function loadBaseline(dir: string): DriftBaseline | null {
  const path = BASELINE_PATH(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DriftBaseline;
  } catch {
    return null;
  }
}

function saveBaseline(dir: string, baseline: DriftBaseline): void {
  const outDir = join(dir, ".agent-research");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(BASELINE_PATH(dir), JSON.stringify(baseline, null, 2));
}

/** Query OSV batch endpoint for up to 1000 packages at once. */
async function queryOsvBatch(
  pkgs: DriftPackage[],
): Promise<Map<string, OsvAdvisory[]>> {
  const results = new Map<string, OsvAdvisory[]>();
  if (pkgs.length === 0) return results;

  // Chunk into batches of 1000 (OSV API limit).
  for (let i = 0; i < pkgs.length; i += 1000) {
    const batch = pkgs.slice(i, i + 1000);
    const body = JSON.stringify({
      queries: batch.map((p) => ({
        version: p.version,
        package: { name: p.name, ecosystem: p.ecosystem },
      })),
    });

    let res: Response;
    try {
      res = await fetch("https://api.osv.dev/v1/querybatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: unknown) {
      throw new Error(`OSV batch request failed: ${(e as Error).message ?? String(e)}`);
    }
    if (!res.ok) throw new Error(`OSV batch API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as { results: Array<{ vulns?: Array<Record<string, unknown>> }> };
    for (let j = 0; j < batch.length; j++) {
      const pkg = batch[j];
      const vulns = data.results[j]?.vulns ?? [];
      const advisories: OsvAdvisory[] = vulns.map((v) => {
        const id = v["id"] as string;
        const severities = (v["severity"] as Array<{ type: string; score: string }> | undefined) ?? [];
        let severity: OsvAdvisory["severity"] = "high";
        for (const sev of severities) {
          if (sev.type === "CVSS_V3") {
            const score = parseFloat(sev.score);
            if (!isNaN(score)) {
              severity = score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";
              break;
            }
          }
        }
        const dbSpec = (v["database_specific"] as Record<string, string> | undefined) ?? {};
        if (severity === "high") {
          const ghsa = (dbSpec["severity"] ?? "").toUpperCase();
          severity = ({ CRITICAL: "critical" as const, HIGH: "high" as const, MODERATE: "medium" as const, LOW: "low" as const })[ghsa] ?? "high";
        }
        const rawSummary = (v["summary"] as string | undefined) ?? "";
        const rawDetails = (v["details"] as string | undefined) ?? "";
        return { id, severity, summary: rawSummary || rawDetails.slice(0, 200), url: `https://osv.dev/vulnerability/${id}` };
      });
      results.set(pkgKey(pkg), advisories);
    }
  }
  return results;
}

/**
 * Seed packages from lockfiles in the project directory.
 * Shells out to scripts/seed-inventory.sh for parity with the skill.
 */
export function seedPackages(dir: string): DriftPackage[] {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const scriptPaths = [
    join(dir, "scripts", "seed-inventory.sh"),
    join(__dirname, "..", "..", "scripts", "seed-inventory.sh"),
  ];
  for (const script of scriptPaths) {
    if (existsSync(script)) {
      try {
        const out = execFileSync("sh", [script, dir], { encoding: "utf8", timeout: 30_000 });
        return JSON.parse(out) as DriftPackage[];
      } catch {
        // fall through
      }
    }
  }
  return [];
}

export async function checkDrift(
  dir: string,
  opts: { updateBaseline?: boolean; packages?: DriftPackage[] } = {},
): Promise<DriftResult> {
  const pkgs = opts.packages ?? seedPackages(dir);
  const baseline = loadBaseline(dir);

  // Query OSV for all packages.
  const currentMap = await queryOsvBatch(pkgs);

  // Build current advisory ID map.
  const currentIds: Record<string, string[]> = {};
  for (const pkg of pkgs) {
    const key = pkgKey(pkg);
    currentIds[key] = (currentMap.get(key) ?? []).map((a) => a.id);
  }

  const newAdvisories: DriftAdvisory[] = [];
  const resolvedAdvisories: DriftAdvisory[] = [];

  if (baseline) {
    for (const pkg of pkgs) {
      const key = pkgKey(pkg);
      const prev = new Set(baseline.advisoryIds[key] ?? []);
      const curr = currentMap.get(key) ?? [];
      for (const adv of curr) {
        if (!prev.has(adv.id)) {
          newAdvisories.push({ ...adv, package: pkg.name, ecosystem: pkg.ecosystem, version: pkg.version });
        }
      }
      // Resolved: was in baseline but gone now.
      const currIds = new Set(curr.map((a) => a.id));
      for (const prevId of prev) {
        if (!currIds.has(prevId)) {
          resolvedAdvisories.push({
            id: prevId, severity: "low", summary: "Advisory no longer reported by OSV",
            url: `https://osv.dev/vulnerability/${prevId}`,
            package: pkg.name, ecosystem: pkg.ecosystem, version: pkg.version,
          });
        }
      }
    }
  }

  if (opts.updateBaseline || !baseline) {
    saveBaseline(dir, {
      createdAt: new Date().toISOString(),
      packages: pkgs.length,
      advisoryIds: currentIds,
    });
  }

  return {
    newAdvisories,
    resolvedAdvisories,
    baselineExists: !!baseline,
    baselineDate: baseline?.createdAt ?? null,
    packagesChecked: pkgs.length,
  };
}

export function renderDriftText(result: DriftResult): string {
  const lines: string[] = [];
  if (!result.baselineExists) {
    lines.push(`brainblast drift: baseline created — ${result.packagesChecked} packages indexed.`);
    lines.push("Re-run without --update-baseline to detect new advisories.");
    return lines.join("\n");
  }
  lines.push(`brainblast drift: checked ${result.packagesChecked} packages against baseline from ${result.baselineDate?.split("T")[0] ?? "unknown"}`);
  if (result.newAdvisories.length === 0 && result.resolvedAdvisories.length === 0) {
    lines.push("  No new advisories. Dependency risk profile unchanged.");
    return lines.join("\n");
  }
  if (result.newAdvisories.length > 0) {
    lines.push(`\n  NEW (${result.newAdvisories.length}):`);
    for (const a of result.newAdvisories) {
      lines.push(`    [${a.severity.toUpperCase()}] ${a.package}@${a.version} — ${a.id}: ${a.summary}`);
      lines.push(`      ${a.url}`);
    }
  }
  if (result.resolvedAdvisories.length > 0) {
    lines.push(`\n  RESOLVED (${result.resolvedAdvisories.length}):`);
    for (const a of result.resolvedAdvisories) {
      lines.push(`    ${a.package}@${a.version} — ${a.id}`);
    }
  }
  return lines.join("\n");
}
