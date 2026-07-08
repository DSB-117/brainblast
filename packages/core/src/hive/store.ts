// HiveMind — the shared second brain for AI agents (store layer).
//
// One machine-global, file-based knowledge substrate that EVERY agent on the
// machine (Claude Code, Codex, Cursor, ...) reads and writes, instead of each
// agent re-learning in its own silo:
//
//   ~/.brainblast/hive/
//     vti/feed.jsonl      synced VTI records (per the caller's entitlement)
//     packs/              public rule packs synced at a pinned commit
//     experience.jsonl    cross-repo fix events (the personal layer)
//     repos.json          linked repos + their dependency index
//     cursor.json         feed cursor + sync provenance
//     grant.json          optional — unlocks full fixtures on sync
//
// Local-first and human-inspectable, like every other Brainblast surface: no
// account, no daemon required, JSONL + JSON on disk. The network side lives in
// hive/sync.ts; this module is layout + state + lot upsert only.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CorpusVti } from "../corpus.ts";
import type { FeedRecord } from "../feed.ts";

export const HIVE_DIR_ENV = "BRAINBLAST_HIVE_DIR";

// The hive root: env override (tests, multi-hive setups) or the user-global
// default. Deliberately user-scoped, not repo-scoped — the whole point is that
// knowledge outlives any one repo or agent session.
export function hiveRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env[HIVE_DIR_ENV] || join(homedir(), ".brainblast", "hive");
}

export interface HivePaths {
  root: string;
  vtiDir: string;
  feedLot: string;
  packsDir: string;
  experienceLog: string;
  cursorFile: string;
  reposFile: string;
  grantFile: string;
}

export function hivePaths(root: string): HivePaths {
  return {
    root,
    vtiDir: join(root, "vti"),
    feedLot: join(root, "vti", "feed.jsonl"),
    packsDir: join(root, "packs"),
    experienceLog: join(root, "experience.jsonl"),
    cursorFile: join(root, "cursor.json"),
    reposFile: join(root, "repos.json"),
    grantFile: join(root, "grant.json"),
  };
}

// ── Sync state ───────────────────────────────────────────────────────────────

export interface HiveCursor {
  schemaVersion: "1.0";
  cursor: string | null; // feed resume cursor (max capturedAt synced)
  lastSyncAt: string | null;
  remote: string | null;
  tier: string | null; // tier the last feed sync was served at
  packsSha: string | null; // pinned commit the hive's packs mirror
  packsSyncedAt: string | null;
}

const EMPTY_CURSOR: HiveCursor = {
  schemaVersion: "1.0",
  cursor: null,
  lastSyncAt: null,
  remote: null,
  tier: null,
  packsSha: null,
  packsSyncedAt: null,
};

export function loadCursor(root: string): HiveCursor {
  const p = hivePaths(root).cursorFile;
  if (!existsSync(p)) return { ...EMPTY_CURSOR };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return {
      schemaVersion: "1.0",
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      lastSyncAt: typeof parsed.lastSyncAt === "string" ? parsed.lastSyncAt : null,
      remote: typeof parsed.remote === "string" ? parsed.remote : null,
      tier: typeof parsed.tier === "string" ? parsed.tier : null,
      packsSha: typeof parsed.packsSha === "string" ? parsed.packsSha : null,
      packsSyncedAt: typeof parsed.packsSyncedAt === "string" ? parsed.packsSyncedAt : null,
    };
  } catch {
    return { ...EMPTY_CURSOR };
  }
}

export function saveCursor(root: string, cursor: HiveCursor): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(hivePaths(root).cursorFile, JSON.stringify(cursor, null, 2));
}

// ── Linked repos (the dependency index briefs + outbreak alerts key off) ─────

export interface HiveRepo {
  path: string; // absolute path
  name: string;
  deps: Record<string, string>; // package name → declared version/range
  linkedAt: string;
}

export interface HiveRepos {
  schemaVersion: "1.0";
  repos: HiveRepo[];
}

export function loadRepos(root: string): HiveRepos {
  const p = hivePaths(root).reposFile;
  if (!existsSync(p)) return { schemaVersion: "1.0", repos: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return {
      schemaVersion: "1.0",
      repos: Array.isArray(parsed.repos) ? parsed.repos.filter((r: any) => r && typeof r.path === "string") : [],
    };
  } catch {
    return { schemaVersion: "1.0", repos: [] };
  }
}

export function saveRepos(root: string, repos: HiveRepos): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(hivePaths(root).reposFile, JSON.stringify(repos, null, 2));
}

// ── VTI lot: feed records, stored in the same CorpusVti shape as every other
//    lot so feedLots.readLots / selectFeed / recall consume the hive identically.

// A streamed FeedRecord carries `receipt` + optional `fixtures`; a lot record
// carries `redGreenProof` + `vulnerable`/`fixed`. Convert on the way in so the
// hive lot is a first-class lot, not a parallel format.
export function feedRecordToVti(r: FeedRecord): CorpusVti {
  const vti: CorpusVti = {
    trapId: r.trapId,
    sdk: { name: r.sdk?.name ?? "unknown", version: r.sdk?.version ?? null },
    severity: r.severity as CorpusVti["severity"],
    class: r.class,
    corroborationCount: r.corroborationCount ?? 0,
    redGreenProof: {
      red: r.receipt?.red === true,
      green: r.receipt?.green === true,
      ...(r.receipt?.method ? { method: r.receipt.method } : {}),
      ...(r.receipt?.verifiedAt ? { verifiedAt: r.receipt.verifiedAt } : {}),
    },
    license: r.license ?? "unknown",
    sourceUrls: Array.isArray(r.sourceUrls) ? r.sourceUrls : [],
  };
  if (typeof r.title === "string") (vti as any).title = r.title;
  if (typeof r.capturedAt === "string") vti.capturedAt = r.capturedAt;
  if (r.fixtures?.vulnerable) (vti as any).vulnerable = r.fixtures.vulnerable;
  if (r.fixtures?.fixed) (vti as any).fixed = r.fixtures.fixed;
  if (r.fixtures?.generatedTest != null) (vti as any).generatedTest = r.fixtures.generatedTest;
  return vti;
}

export function vtiKey(v: { trapId: string; sdk?: { name?: string; version?: string | null } }): string {
  return `${v.trapId}::${v.sdk?.name ?? ""}::${v.sdk?.version ?? ""}`;
}

export function loadHiveLot(root: string): CorpusVti[] {
  const p = hivePaths(root).feedLot;
  if (!existsSync(p)) return [];
  const out: CorpusVti[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as CorpusVti);
    } catch {
      // A malformed line is dropped on the next rewrite; never fatal on read.
    }
  }
  return out;
}

export interface UpsertResult {
  added: number;
  updated: number;
  unchanged: number;
  total: number; // records in the lot after the upsert
}

// Does the incoming copy of an already-held record carry anything new? Two real
// cases: a tier upgrade (fixtures now present — the trainable payload arrived),
// and a corroboration bump (the swarm confirmed it in more repos, which raises
// its score and brief ranking).
function isRicher(incoming: CorpusVti, stored: CorpusVti): boolean {
  const gainedFixtures =
    ((incoming as any).vulnerable?.snippet || (incoming as any).fixed?.snippet) &&
    !((stored as any).vulnerable?.snippet || (stored as any).fixed?.snippet);
  const gainedCorroboration = (incoming.corroborationCount ?? 0) > (stored.corroborationCount ?? 0);
  return Boolean(gainedFixtures) || gainedCorroboration;
}

// Merge an incoming richer copy over the stored one WITHOUT losing knowledge:
// a corroboration bump served at sample tier must not strip fixtures a paid
// sync already delivered. Incoming wins field-by-field; the trainable payload
// is carried forward when the incoming copy lacks it.
function mergeVti(incoming: CorpusVti, stored: CorpusVti): CorpusVti {
  const merged: CorpusVti = { ...stored, ...incoming };
  if (!(incoming as any).vulnerable?.snippet && (stored as any).vulnerable?.snippet) {
    (merged as any).vulnerable = (stored as any).vulnerable;
  }
  if (!(incoming as any).fixed?.snippet && (stored as any).fixed?.snippet) {
    (merged as any).fixed = (stored as any).fixed;
  }
  if ((incoming as any).generatedTest == null && (stored as any).generatedTest != null) {
    (merged as any).generatedTest = (stored as any).generatedTest;
  }
  merged.corroborationCount = Math.max(incoming.corroborationCount ?? 0, stored.corroborationCount ?? 0);
  return merged;
}

// Idempotent, non-destructive merge (same discipline as the fleet ledger): new
// keys append, richer copies replace, everything else is left alone. Rewrites
// the lot in one pass — hive lots are small enough that atomicity beats an
// append-only log with tombstones.
export function upsertVtis(root: string, incoming: CorpusVti[]): UpsertResult {
  const paths = hivePaths(root);
  const existing = loadHiveLot(root);
  const byKey = new Map(existing.map((v) => [vtiKey(v), v]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const vti of incoming) {
    if (!vti || typeof vti.trapId !== "string") continue;
    const key = vtiKey(vti);
    const stored = byKey.get(key);
    if (!stored) {
      byKey.set(key, vti);
      added++;
    } else if (isRicher(vti, stored)) {
      byKey.set(key, mergeVti(vti, stored));
      updated++;
    } else {
      unchanged++;
    }
  }

  mkdirSync(paths.vtiDir, { recursive: true });
  const records = [...byKey.values()];
  // Oldest-first, matching the feed's own cursor ordering.
  records.sort((a, b) => String(a.capturedAt ?? "").localeCompare(String(b.capturedAt ?? "")));
  writeFileSync(paths.feedLot, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));

  return { added, updated, unchanged, total: records.length };
}
