import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { OnChainProgram } from "./types.ts";

// ── Program-keyed persistent cache (Phase 4) ─────────────────────────────────
//
// Trust-graph entries are expensive to obtain (live RPC, research skills, manual
// curation). This cache lets a second project's run reuse what a first run
// discovered, without hitting the network again.
//
// Default location:  ~/.brainblast/program-cache.json
// Override via:      BuildOpts.cachePath  or  BRAINBLAST_CACHE_PATH env var
//
// Cache format (schemaVersion "1.0"):
//   {
//     "schemaVersion": "1.0",
//     "entries": {
//       "<base58-program-id>": {
//         "program": { ...OnChainProgram },
//         "cachedAt": "2026-06-08T21:00:00.000Z",   ← ISO timestamp
//         "sourceRun": "20260608T210000",             ← run.id from the report
//         "ttlHours": 168                             ← optional, defaults to DEFAULT_TTL_HOURS
//       }
//     }
//   }

export const DEFAULT_TTL_HOURS = 168; // 1 week
export const SCHEMA_VERSION = "1.0";

export interface ProgramCacheEntry {
  program: OnChainProgram;
  /** ISO 8601 timestamp of when this entry was written. */
  cachedAt: string;
  /** The run.id from the brainblast report that produced this entry. */
  sourceRun: string;
  /** Hours until this entry expires. Defaults to DEFAULT_TTL_HOURS. */
  ttlHours?: number;
}

export interface ProgramCache {
  schemaVersion: typeof SCHEMA_VERSION;
  entries: Record<string, ProgramCacheEntry>;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function defaultCachePath(): string {
  const envOverride = process.env["BRAINBLAST_CACHE_PATH"];
  return envOverride ?? join(homedir(), ".brainblast", "program-cache.json");
}

function emptyCache(): ProgramCache {
  return { schemaVersion: SCHEMA_VERSION, entries: {} };
}

// ── Load / save ───────────────────────────────────────────────────────────────

/**
 * Load the program cache from disk.
 *
 * Returns an empty cache if the file does not exist, is unreadable, or has an
 * incompatible schemaVersion. Never throws on missing/corrupt files — callers
 * can always start fresh.
 */
export function loadProgramCache(cachePath?: string): ProgramCache {
  const path = cachePath ?? defaultCachePath();
  if (!existsSync(path)) return emptyCache();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ProgramCache>;
    if (raw?.schemaVersion !== SCHEMA_VERSION) {
      // Schema mismatch — discard stale cache rather than crash.
      return emptyCache();
    }
    if (!raw.entries || typeof raw.entries !== "object") return emptyCache();
    return { schemaVersion: SCHEMA_VERSION, entries: raw.entries };
  } catch {
    return emptyCache();
  }
}

/**
 * Persist the program cache to disk, creating parent directories as needed.
 * Throws only on unrecoverable write errors (e.g. permission denied on the
 * home directory itself).
 */
export function saveProgramCache(cache: ProgramCache, cachePath?: string): void {
  const path = cachePath ?? defaultCachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
}

// ── Entry accessors ───────────────────────────────────────────────────────────

/**
 * Return the cached OnChainProgram for programId, or null if:
 *   - the entry does not exist
 *   - the entry has exceeded its TTL
 *
 * @param ttlHoursOverride - optional override for the TTL check (e.g. for tests)
 */
export function getCacheEntry(
  cache: ProgramCache,
  programId: string,
  ttlHoursOverride?: number,
): OnChainProgram | null {
  const entry = cache.entries[programId];
  if (!entry) return null;
  if (isEntryExpired(entry, ttlHoursOverride)) return null;
  return entry.program;
}

/**
 * Write (or overwrite) a cache entry for programId.
 * Mutates the cache object in place and returns it for chaining.
 */
export function putCacheEntry(
  cache: ProgramCache,
  programId: string,
  program: OnChainProgram,
  sourceRun: string,
  ttlHours: number = DEFAULT_TTL_HOURS,
): ProgramCache {
  cache.entries[programId] = {
    program,
    cachedAt: new Date().toISOString(),
    sourceRun,
    ttlHours,
  };
  return cache;
}

/**
 * Return the raw ProgramCacheEntry for programId (including metadata), or null.
 * Useful for rendering provenance to users ("cached 3 days ago by run X").
 */
export function getCacheEntryMeta(
  cache: ProgramCache,
  programId: string,
): ProgramCacheEntry | null {
  return cache.entries[programId] ?? null;
}

// ── TTL helpers ───────────────────────────────────────────────────────────────

export function isEntryExpired(entry: ProgramCacheEntry, ttlHoursOverride?: number): boolean {
  const ttl = ttlHoursOverride ?? entry.ttlHours ?? DEFAULT_TTL_HOURS;
  // TTL of 0 (or negative) means "already expired" — useful for tests and forced refresh.
  if (ttl <= 0) return true;
  const cachedMs = Date.parse(entry.cachedAt);
  if (Number.isNaN(cachedMs)) return true; // malformed timestamp → treat as expired
  const ageMs = Date.now() - cachedMs;
  return ageMs >= ttl * 3_600_000;
}

/**
 * Count of non-expired entries in the cache (useful for status lines).
 */
export function cacheSize(cache: ProgramCache, ttlHoursOverride?: number): number {
  return Object.values(cache.entries).filter((e) => !isEntryExpired(e, ttlHoursOverride)).length;
}
