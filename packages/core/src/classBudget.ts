// Class-budget gate — the corpus-rebalance mechanism (Lane 2).
//
// The corpus's VALUE is proven-pairs × CLASS BALANCE × modality breadth, not raw
// count. Left ungated, the fleet floods the easy classes (auth-bypass /
// missing-verification are the bulk of every SDK) and the scarce, high-value
// classes buyers pay for (staleness, silent-revenue, slippage, wrong-constant)
// stay starved. This turns the corpus's own class distribution into an
// enforceable budget:
//
//   • a class at/above MAX_SHARE is a SURPLUS — new submissions in it are
//     deferred (the submit gate) so effort moves elsewhere;
//   • a class below MIN_SHARE is a DEFICIT — it leads the scout work order;
//   • everything else is OK.
//
// Targets mirror the roadmap's "working when": no single class > 25%, every
// bottom-class > 5%. Pure — counts in, verdicts out; no fs/network (callers read
// the live distribution from datasets/catalog.json or the registry export).

import { TRAP_CLASSES, type TrapClass } from "./vtiClass.ts";

export const MAX_SHARE = 0.25; // a class over this is over-represented → gate it
export const MIN_SHARE = 0.05; // a class under this is starved → prioritize it

// "other" is a catch-all bucket, not a real target class: it can be capped
// (gated when it balloons) but is never something we ask scouts to grow.
const CATCH_ALL: TrapClass = "other";

export type ClassCounts = Record<string, number>;
export type BudgetStatus = "surplus" | "deficit" | "ok";

export interface ClassBudgetRow {
  class: TrapClass;
  count: number;
  share: number; // 0..1
  status: BudgetStatus;
  /** New records this class needs before it clears MIN_SHARE (0 if already ≥). */
  needToMin: number;
  /** New records this class can still take before it hits MAX_SHARE (0 if already ≥). */
  roomToMax: number;
}

export interface ClassBudget {
  total: number;
  rows: ClassBudgetRow[];
  /** Classes to pour into next — deficit/ok, scarcest first; excludes "other". */
  workOrder: TrapClass[];
}

// Solve for k added records such that (count+k)/(total+k) crosses a target share.
// Adding to one class also grows the denominator, so it's not just target*total.
function toReachShare(count: number, total: number, target: number): number {
  // (count + k) / (total + k) = target  →  k = (target*total - count) / (1 - target)
  const k = (target * total - count) / (1 - target);
  return Math.max(0, Math.ceil(k));
}
function roomUnderShare(count: number, total: number, target: number): number {
  // largest k with (count + k)/(total + k) ≤ target
  const k = (target * total - count) / (1 - target);
  return Math.max(0, Math.floor(k));
}

export function computeClassBudget(counts: ClassCounts): ClassBudget {
  const total = TRAP_CLASSES.reduce((s, c) => s + (counts[c] ?? 0), 0);
  const rows: ClassBudgetRow[] = TRAP_CLASSES.map((c) => {
    const count = counts[c] ?? 0;
    const share = total > 0 ? count / total : 0;
    let status: BudgetStatus;
    if (share >= MAX_SHARE) status = "surplus";
    else if (c !== CATCH_ALL && share < MIN_SHARE) status = "deficit";
    else status = "ok";
    return {
      class: c,
      count,
      share,
      status,
      needToMin: c === CATCH_ALL ? 0 : toReachShare(count, total, MIN_SHARE),
      roomToMax: status === "surplus" ? 0 : roomUnderShare(count, total, MAX_SHARE),
    };
  });

  const workOrder = rows
    .filter((r) => r.class !== CATCH_ALL && r.status !== "surplus")
    .sort((a, b) => a.share - b.share || b.needToMin - a.needToMin)
    .map((r) => r.class);

  return { total, rows, workOrder };
}

export interface GateVerdict {
  allow: boolean;
  class: TrapClass;
  status: BudgetStatus;
  share: number;
  reason: string;
  /** Scarce classes to scout instead, when deferred. */
  suggest: TrapClass[];
}

// The enforceable gate: may a candidate of `cls` be added given the current
// distribution? Deferred only when the class is a SURPLUS (≥ MAX_SHARE). An empty
// corpus (total 0) always allows — bootstrap.
export function gateClass(cls: string, counts: ClassCounts): GateVerdict {
  const budget = computeClassBudget(counts);
  const known = (TRAP_CLASSES as readonly string[]).includes(cls) ? (cls as TrapClass) : CATCH_ALL;
  const row = budget.rows.find((r) => r.class === known)!;
  const pct = (row.share * 100).toFixed(1);
  if (budget.total === 0) {
    return { allow: true, class: known, status: "ok", share: 0, reason: "corpus is empty — bootstrapping", suggest: [] };
  }
  if (row.status === "surplus") {
    return {
      allow: false,
      class: known,
      status: "surplus",
      share: row.share,
      reason: `class '${known}' is ${pct}% of the corpus (≥ ${(MAX_SHARE * 100).toFixed(0)}% cap) — deferring to rebalance`,
      suggest: budget.workOrder.slice(0, 3),
    };
  }
  const note = row.status === "deficit" ? ` — scarce (< ${(MIN_SHARE * 100).toFixed(0)}%), prioritized` : "";
  return { allow: true, class: known, status: row.status, share: row.share, reason: `class '${known}' at ${pct}%${note}`, suggest: [] };
}

// Convenience: pull a ClassCounts out of a corpus-index.json / catalog.json shape
// ({ classDistribution: { <class>: n } }). Kept here so callers don't re-derive it.
export function countsFromDistribution(obj: unknown): ClassCounts {
  const dist = (obj as { classDistribution?: Record<string, number> })?.classDistribution;
  const out: ClassCounts = {};
  if (dist && typeof dist === "object") {
    for (const [k, v] of Object.entries(dist)) if (typeof v === "number") out[k] = v;
  }
  return out;
}
