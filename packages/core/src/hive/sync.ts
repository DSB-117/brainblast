// HiveMind sync — the network half of the hive (store layout in hive/store.ts).
//
// Two one-way flows keep the local brain current, and neither needs new server
// infrastructure — the feed's `since` cursor IS the subscription primitive:
//
//   1. syncFeed  — pull the VTI delta from the hosted distribution endpoint
//      (anonymous → sample tier; a grant in the hive unlocks full fixtures).
//   2. syncPacks — mirror the PUBLIC rule packs at a pinned commit, so the
//      enforcement layer (audit) carries knowledge merged upstream minutes ago,
//      free for everyone — friction only ever sits at the trainable-payload
//      boundary, never at protection.
//
// Every fetch goes through an injectable `fetchImpl` (the firewall/OSV pattern)
// so the whole pipeline is deterministic and unit-testable offline. Cursor
// discipline is fail-closed: a response without a `feed_complete` line never
// advances the cursor.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { FeedRecord } from "../feed.ts";
import { DEFAULT_REGISTRY_URL } from "../telemetry.ts";
import {
  feedRecordToVti,
  hivePaths,
  loadCursor,
  loadRepos,
  saveCursor,
  upsertVtis,
  type UpsertResult,
} from "./store.ts";
import { detectOutbreaks, type Outbreak } from "./outbreak.ts";

export const DEFAULT_HIVE_REMOTE = `${DEFAULT_REGISTRY_URL}/api`;
export const DEFAULT_PACKS_REPO = "DSB-117/brainblast";
export const DEFAULT_PACKS_REF = "main";

type FetchImpl = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

// ── Feed sync ────────────────────────────────────────────────────────────────

export interface SyncFeedOpts {
  root: string;
  remote?: string; // base URL serving /feed (default: the hosted registry API)
  grantPath?: string; // default: <root>/grant.json when present
  fresh?: boolean; // ignore the stored cursor and re-pull from the beginning
  fetchImpl?: FetchImpl;
  now?: string; // injectable clock for deterministic tests
}

export interface SyncFeedReport {
  remote: string;
  tier: string | null; // what the server actually served (from feed_meta)
  granted: boolean;
  fetched: number; // vti lines in the response
  added: number;
  updated: number;
  unchanged: number;
  total: number; // hive lot size after the sync
  cursor: string | null;
  warnings: string[];
  // Newly-landed high/critical traps that bind to a linked repo's dependency
  // index — the hive telling you a repo you maintain just became exposed.
  outbreaks: Outbreak[];
}

export async function syncFeed(opts: SyncFeedOpts): Promise<SyncFeedReport> {
  const fetchImpl: FetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchImpl);
  const paths = hivePaths(opts.root);
  const cursor = loadCursor(opts.root);
  const remote = (opts.remote ?? cursor.remote ?? DEFAULT_HIVE_REMOTE).replace(/\/+$/, "");
  const warnings: string[] = [];

  const params = new URLSearchParams();
  const since = opts.fresh ? undefined : cursor.cursor ?? undefined;
  if (since) params.set("since", since);
  const url = `${remote}/feed${params.toString() ? `?${params}` : ""}`;

  const headers: Record<string, string> = {};
  const grantPath = opts.grantPath ?? (existsSync(paths.grantFile) ? paths.grantFile : undefined);
  if (grantPath) {
    if (!existsSync(grantPath)) throw new Error(`hive sync: grant not found: ${grantPath}`);
    headers["x-brainblast-grant"] = Buffer.from(readFileSync(grantPath, "utf8")).toString("base64");
  }

  const res = await fetchImpl(url, { headers });
  const body = await res.text();
  if (res.status !== 200) {
    throw new Error(`hive sync: ${url} returned ${res.status}: ${body.trim().slice(0, 300)}`);
  }

  let tier: string | null = null;
  let nextCursor: string | undefined;
  let sawComplete = false;
  const records: FeedRecord[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(t);
    } catch {
      warnings.push("malformed NDJSON line in feed response (skipped)");
      continue;
    }
    if (parsed.type === "feed_meta") tier = typeof parsed.tier === "string" ? parsed.tier : null;
    else if (parsed.type === "vti") records.push(parsed as FeedRecord);
    else if (parsed.type === "feed_complete") {
      sawComplete = true;
      if (typeof parsed.cursor === "string") nextCursor = parsed.cursor;
    }
  }

  // Fail-closed cursor discipline: without feed_complete we may have a
  // truncated response — ingest nothing and try again next sync.
  if (!sawComplete) {
    throw new Error(`hive sync: feed response from ${url} had no feed_complete line (truncated?) — not ingested`);
  }

  const upsert: UpsertResult = upsertVtis(opts.root, records.map(feedRecordToVti));

  const nowIso = opts.now ?? new Date().toISOString();
  saveCursor(opts.root, {
    ...cursor,
    // The server returns the caller's `since` back when nothing new matched —
    // never regress the cursor below what we already hold.
    cursor: nextCursor && (!cursor.cursor || nextCursor > cursor.cursor) ? nextCursor : cursor.cursor,
    lastSyncAt: nowIso,
    remote,
    tier,
  });

  return {
    remote,
    tier,
    granted: Boolean(grantPath),
    fetched: records.length,
    added: upsert.added,
    updated: upsert.updated,
    unchanged: upsert.unchanged,
    total: upsert.total,
    cursor: loadCursor(opts.root).cursor,
    warnings,
    outbreaks: detectOutbreaks(upsert.addedRecords, loadRepos(opts.root).repos),
  };
}

// ── Pack sync (the enforcement layer's supply line) ──────────────────────────

export interface SyncPacksOpts {
  root: string;
  repo?: string; // owner/name on GitHub
  ref?: string; // branch or tag to resolve
  force?: boolean; // re-mirror even when the resolved sha is unchanged
  fetchImpl?: FetchImpl;
  now?: string;
}

export interface SyncPacksReport {
  repo: string;
  sha: string;
  skipped: boolean; // sha unchanged and not --force
  packs: number;
  filesFetched: number;
  removedPacks: string[];
  warnings: string[];
}

// git blob sha1 (`sha1("blob <len>\0" + content)`) — verifies every mirrored
// file against the commit tree we pinned, so a tampered or truncated transfer
// can't land in the enforcement path. Same tamper-evidence discipline as
// SHA256SUMS on released lots.
export function gitBlobSha1(content: string): string {
  const buf = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest("hex");
}

const PACK_FILE_RE = /^packs\/([a-z0-9][a-z0-9-]*)\/(brainblast-pack\.yaml|rules\/[^/]+\.ya?ml)$/;

async function getJson(fetchImpl: FetchImpl, url: string): Promise<any> {
  const res = await fetchImpl(url, { headers: { accept: "application/vnd.github+json", "user-agent": "brainblast-hive" } });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`hive sync: ${url} returned ${res.status}: ${body.trim().slice(0, 200)}`);
  return JSON.parse(body);
}

export async function syncPacks(opts: SyncPacksOpts): Promise<SyncPacksReport> {
  const fetchImpl: FetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchImpl);
  const repo = opts.repo ?? DEFAULT_PACKS_REPO;
  const ref = opts.ref ?? DEFAULT_PACKS_REF;
  const paths = hivePaths(opts.root);
  const cursor = loadCursor(opts.root);
  const warnings: string[] = [];

  // Resolve the ref to a commit — everything after this is pinned to that sha.
  const commit = await getJson(fetchImpl, `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`);
  const sha: string = commit?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`hive sync: could not resolve ${repo}@${ref} to a commit sha`);
  }

  if (sha === cursor.packsSha && !opts.force) {
    const packs = existsSync(paths.packsDir)
      ? (await import("node:fs")).readdirSync(paths.packsDir).filter((e) => !e.startsWith(".")).length
      : 0;
    return { repo, sha, skipped: true, packs, filesFetched: 0, removedPacks: [], warnings };
  }

  const tree = await getJson(fetchImpl, `https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`);
  if (tree?.truncated) warnings.push("GitHub tree listing was truncated — pack mirror may be incomplete");
  const entries: { path: string; sha: string }[] = (Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((e: any) => e?.type === "blob" && typeof e.path === "string" && PACK_FILE_RE.test(e.path))
    .map((e: any) => ({ path: e.path, sha: e.sha }));
  if (entries.length === 0) {
    throw new Error(`hive sync: ${repo}@${ref} has no pack files under packs/ — refusing to empty the mirror`);
  }

  // Mirror exactly: fetch every rule/manifest at the pinned sha, verify each
  // blob hash, then drop local packs that no longer exist upstream (a withdrawn
  // pack must vanish from the enforcement path too).
  //
  // Transport is untrusted either way — the git-blob hash check below is what
  // guarantees integrity — so when raw.githubusercontent.com rate-limits a
  // full mirror (429; ~180 files on a cold sync), fall back to the jsDelivr
  // CDN at the SAME pinned commit rather than failing the sync.
  let filesFetched = 0;
  let fellBack = false;
  const upstreamPacks = new Set<string>();
  for (const entry of entries) {
    upstreamPacks.add(entry.path.split("/")[1]);
    let res = await fetchImpl(`https://raw.githubusercontent.com/${repo}/${sha}/${entry.path}`, {
      headers: { "user-agent": "brainblast-hive" },
    });
    if (res.status === 429 || res.status === 403) {
      res = await fetchImpl(`https://cdn.jsdelivr.net/gh/${repo}@${sha}/${entry.path}`, {
        headers: { "user-agent": "brainblast-hive" },
      });
      fellBack = true;
    }
    const content = await res.text();
    if (res.status !== 200) throw new Error(`hive sync: fetching ${entry.path} returned ${res.status}`);
    if (gitBlobSha1(content) !== entry.sha) {
      throw new Error(`hive sync: blob hash mismatch for ${entry.path} — transfer tampered or truncated, aborting`);
    }
    const dest = join(paths.packsDir, entry.path.slice("packs/".length));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    filesFetched++;
  }
  if (fellBack) warnings.push("raw.githubusercontent.com rate-limited; some files were mirrored via the jsDelivr CDN (same pinned commit, blob-verified)");

  const removedPacks: string[] = [];
  if (existsSync(paths.packsDir)) {
    const { readdirSync, statSync } = await import("node:fs");
    for (const entry of readdirSync(paths.packsDir)) {
      const dir = join(paths.packsDir, entry);
      if (!statSync(dir).isDirectory()) continue;
      if (!upstreamPacks.has(entry)) {
        rmSync(dir, { recursive: true, force: true });
        removedPacks.push(entry);
      }
    }
  }

  saveCursor(opts.root, {
    ...loadCursor(opts.root),
    packsSha: sha,
    packsSyncedAt: opts.now ?? new Date().toISOString(),
  });

  return { repo, sha, skipped: false, packs: upstreamPacks.size, filesFetched, removedPacks, warnings };
}
