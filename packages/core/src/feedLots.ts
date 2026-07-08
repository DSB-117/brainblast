// Lot loading for the feed + recall surfaces (the fs side that feed.ts, being
// pure, deliberately doesn't do). Shared so `brainblast feed` (CLI) and the
// `brainblast_recall` MCP tool read lots identically.

import { existsSync, readFileSync } from "node:fs";
import type { CorpusVti } from "./corpus.ts";
import { selectFeed, type FeedQuery, type FeedResult } from "./feed.ts";
import { hivePaths, hiveRoot, vtiKey } from "./hive/store.ts";

// The repo's default lots (owned seed + the git-ignored contributor lot). In an
// installed context these won't exist — the caller passes explicit lot paths.
export const DEFAULT_LOT_PATHS = ["datasets/seed/seed-vti.jsonl", "datasets/contrib/contrib-vti.jsonl"];

export function resolveLotPaths(explicit: string[]): string[] {
  if (explicit.length) return explicit;
  return DEFAULT_LOT_PATHS.filter((p) => existsSync(p));
}

// Recall's default lots additionally include the HIVE lot — the machine-global
// brain synced from the live feed — so an agent recalls everything it knows,
// not just what this repo happens to hold. (The `feed` CLI keeps the repo-only
// default: distribution serves lots YOU produce, recall reads lots you KNOW.)
export function resolveRecallLotPaths(explicit: string[]): string[] {
  if (explicit.length) return explicit;
  const paths = DEFAULT_LOT_PATHS.filter((p) => existsSync(p));
  const hiveLot = hivePaths(hiveRoot()).feedLot;
  if (existsSync(hiveLot)) paths.push(hiveLot);
  return paths;
}

// The same trap can legitimately appear in a repo lot AND the hive (the hive
// syncs the published corpus). Keep the richer copy: fixtures beat none,
// higher corroboration beats lower.
export function dedupeVtis(vtis: CorpusVti[]): CorpusVti[] {
  const byKey = new Map<string, CorpusVti>();
  for (const v of vtis) {
    const key = vtiKey(v);
    const held = byKey.get(key);
    if (!held) {
      byKey.set(key, v);
      continue;
    }
    const heldFixtures = Boolean((held as any).vulnerable?.snippet || (held as any).fixed?.snippet);
    const vFixtures = Boolean((v as any).vulnerable?.snippet || (v as any).fixed?.snippet);
    if ((vFixtures && !heldFixtures) || (vFixtures === heldFixtures && (v.corroborationCount ?? 0) > (held.corroborationCount ?? 0))) {
      byKey.set(key, v);
    }
  }
  return [...byKey.values()];
}

export function readLots(paths: string[]): { vtis: CorpusVti[]; errors: string[] } {
  const vtis: CorpusVti[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      errors.push(`lot not found: ${p}`);
      continue;
    }
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        vtis.push(JSON.parse(t) as CorpusVti);
      } catch {
        errors.push(`malformed line in ${p}`);
      }
    }
  }
  return { vtis, errors };
}

export interface RecallResult {
  lots: string[];
  result: FeedResult;
  errors: string[];
}

// Recall the verified traps an agent should know about for the code it's writing.
// Unlike the *delivery* feed (which is $BRAIN-tier-gated by distribution), recall
// reads lots you ALREADY POSSESS — so it gives full visibility (firehose
// entitlement: receipts + the trainable fixtures). The gate is which lots you
// hold, not a local read.
export function recallFeed(args: { lots?: string[] } & FeedQuery): RecallResult {
  const lots = resolveRecallLotPaths(args.lots ?? []);
  const { vtis, errors } = readLots(lots);
  const result = selectFeed(dedupeVtis(vtis), args, "firehose");
  return { lots, result, errors };
}
