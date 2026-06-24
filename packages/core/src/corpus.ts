// Corpus intelligence — Stage 3 of ROADMAP-TRAINING-DATA.md.
//
// Turns a growing pile of Verified Trap Instances (across every lot — owned seed
// AND contributor) into a MANAGED corpus: a deterministic quality score per
// record, exact-duplicate detection, and a class×SDK coverage map that doubles
// as scout's work-order list (thin cells are where to dig next). This is the
// layer pricing and the $BRAIN curation market key off.
//
// Pure: takes parsed records, returns an index. No fs/network here (the script
// in scripts/corpus-report.ts does the reading/writing).

import { createHash } from "node:crypto";
import { TRAP_CLASSES, type TrapClass } from "./vtiClass.ts";

export interface CorpusVti {
  trapId: string;
  sdk: { name: string; version?: string | null };
  severity: "critical" | "high" | "medium" | "low";
  class: TrapClass;
  corroborationCount?: number;
  redGreenProof?: { red?: boolean; green?: boolean };
  vulnerable?: { snippet?: string };
  license?: string;
  capturedAt?: string;
  [k: string]: unknown;
}

export interface ScoredVti {
  trapId: string;
  sdk: string;
  class: TrapClass;
  severity: CorpusVti["severity"];
  corroborationCount: number;
  license: string;
  score: number; // 0..100
  duplicateOf?: string; // dedup key when this record is a duplicate of an earlier one
}

const SEVERITY_WEIGHT: Record<CorpusVti["severity"], number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
};

// Deterministic quality score in [0,100]. Three factors, all explainable:
//   severity   — how much a buyer/model cares about getting this right
//   proof      — RED→GREEN proven (the reward-gradability that defines a VTI)
//   corroboration — distinct repos that confirmed the fix (field truth), capped
// Synthetic-owned records (corroboration 0) get the proof+severity base; field-
// corroborated contributions score higher. A record that is not proven scores 0.
export function scoreVti(v: CorpusVti): number {
  const sev = SEVERITY_WEIGHT[v.severity] ?? 0.3;
  const proven = v.redGreenProof?.red === true && v.redGreenProof?.green === true;
  if (!proven) return 0;
  const corr = Math.max(0, v.corroborationCount ?? 0);
  const corrFactor = Math.min(corr, 5) / 5; // 0..1, saturates at 5 repos
  return Math.round(100 * sev * (0.6 + 0.4 * corrFactor));
}

// Identity for de-duplication: same trap, same SDK, same (whitespace-normalized)
// vulnerable snippet. Two contributors hitting the identical trap in identical
// code is one data point, not two.
export function dedupKey(v: CorpusVti): string {
  const snippet = (v.vulnerable?.snippet ?? "").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${v.trapId}\0${v.sdk?.name ?? ""}\0${snippet}`).digest("hex").slice(0, 16);
}

export interface CorpusIndex {
  schemaVersion: "1.0";
  counts: { vtis: number; unique: number; duplicates: number; sdks: number; classes: number };
  severityDistribution: Record<string, number>;
  classDistribution: Record<string, number>;
  sdkDistribution: Record<string, number>;
  licenseDistribution: Record<string, number>;
  quality: { mean: number; median: number; min: number; max: number; buckets: { high: number; medium: number; low: number } };
  coverage: {
    // class → sdk → count, over UNIQUE records only
    matrix: Record<string, Record<string, number>>;
    // cells present with only one instance — candidates for scout to deepen
    thinCells: { class: TrapClass; sdk: string }[];
    // classes / sdks with no coverage at all (gaps to fill)
    missingClasses: TrapClass[];
  };
  scored: ScoredVti[];
}

function distribution<T extends string>(items: T[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const i of items) d[i] = (d[i] ?? 0) + 1;
  return d;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function buildCorpusIndex(vtis: CorpusVti[]): CorpusIndex {
  const seen = new Set<string>();
  const scored: ScoredVti[] = [];
  const unique: CorpusVti[] = [];

  for (const v of vtis) {
    const key = dedupKey(v);
    const isDup = seen.has(key);
    if (!isDup) seen.add(key);
    scored.push({
      trapId: v.trapId,
      sdk: v.sdk?.name ?? "unknown",
      class: v.class,
      severity: v.severity,
      corroborationCount: Math.max(0, v.corroborationCount ?? 0),
      license: v.license ?? "unknown",
      score: scoreVti(v),
      ...(isDup ? { duplicateOf: key } : {}),
    });
    if (!isDup) unique.push(v);
  }

  const scores = scored.filter((s) => !s.duplicateOf).map((s) => s.score);
  const sdks = [...new Set(unique.map((v) => v.sdk?.name ?? "unknown"))].sort();

  // Coverage matrix over unique records.
  const matrix: Record<string, Record<string, number>> = {};
  for (const v of unique) {
    (matrix[v.class] ??= {})[v.sdk?.name ?? "unknown"] = ((matrix[v.class] ?? {})[v.sdk?.name ?? "unknown"] ?? 0) + 1;
  }
  const thinCells: { class: TrapClass; sdk: string }[] = [];
  for (const [cls, row] of Object.entries(matrix)) {
    for (const [sdk, n] of Object.entries(row)) if (n === 1) thinCells.push({ class: cls as TrapClass, sdk });
  }
  const presentClasses = new Set(unique.map((v) => v.class));
  const missingClasses = TRAP_CLASSES.filter((c) => c !== "other" && !presentClasses.has(c));

  return {
    schemaVersion: "1.0",
    counts: {
      vtis: vtis.length,
      unique: unique.length,
      duplicates: vtis.length - unique.length,
      sdks: sdks.length,
      classes: presentClasses.size,
    },
    severityDistribution: distribution(unique.map((v) => v.severity)),
    classDistribution: distribution(unique.map((v) => v.class)),
    sdkDistribution: distribution(unique.map((v) => v.sdk?.name ?? "unknown")),
    licenseDistribution: distribution(unique.map((v) => v.license ?? "unknown")),
    quality: {
      mean: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      median: median(scores),
      min: scores.length ? Math.min(...scores) : 0,
      max: scores.length ? Math.max(...scores) : 0,
      buckets: {
        high: scores.filter((s) => s >= 70).length,
        medium: scores.filter((s) => s >= 40 && s < 70).length,
        low: scores.filter((s) => s < 40).length,
      },
    },
    coverage: { matrix, thinCells, missingClasses },
    scored,
  };
}
