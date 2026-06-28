// Lot loading for the feed + recall surfaces (the fs side that feed.ts, being
// pure, deliberately doesn't do). Shared so `brainblast feed` (CLI) and the
// `brainblast_recall` MCP tool read lots identically.

import { existsSync, readFileSync } from "node:fs";
import type { CorpusVti } from "./corpus.ts";
import { selectFeed, type FeedQuery, type FeedResult } from "./feed.ts";

// The repo's default lots (owned seed + the git-ignored contributor lot). In an
// installed context these won't exist — the caller passes explicit lot paths.
export const DEFAULT_LOT_PATHS = ["datasets/seed/seed-vti.jsonl", "datasets/contrib/contrib-vti.jsonl"];

export function resolveLotPaths(explicit: string[]): string[] {
  if (explicit.length) return explicit;
  return DEFAULT_LOT_PATHS.filter((p) => existsSync(p));
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
  const lots = resolveLotPaths(args.lots ?? []);
  const { vtis, errors } = readLots(lots);
  const result = selectFeed(vtis, args, "firehose");
  return { lots, result, errors };
}
