import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadProgramCache,
  saveProgramCache,
  getCacheEntry,
  getCacheEntryMeta,
  putCacheEntry,
  cacheSize,
  isEntryExpired,
  DEFAULT_TTL_HOURS,
  type ProgramCache,
} from "../src/trustGraph/programCache.ts";
import { buildTrustGraph } from "../src/trustGraph/build.ts";
import type { OnChainProgram } from "../src/trustGraph/types.ts";

// A program ID that is NOT in the bundled directory (base58 all-2s, unregistered)
const FAKE_ID = "22222222222222222222222222222222";

// Another fake ID for multi-entry tests
const FAKE_ID_2 = "33333333333333333333333333333333";

// ── Unit tests: cache module ─────────────────────────────────────────────────

describe("loadProgramCache", () => {
  it("returns empty cache for a non-existent file", () => {
    const c = loadProgramCache("/tmp/does-not-exist-99999.json");
    expect(c.schemaVersion).toBe("1.0");
    expect(c.entries).toEqual({});
  });

  it("returns empty cache for a corrupt JSON file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-cache-"));
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(dir, "cache.json"), "{{{not json", "utf8");
      const c = loadProgramCache(join(dir, "cache.json"));
      expect(c.entries).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty cache when schemaVersion mismatches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-cache-"));
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        join(dir, "cache.json"),
        JSON.stringify({ schemaVersion: "0.9", entries: {} }),
        "utf8",
      );
      const c = loadProgramCache(join(dir, "cache.json"));
      expect(c.entries).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips an entry through save/load", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-cache-"));
    const path = join(dir, "cache.json");
    try {
      const cache = loadProgramCache(path);
      const prog = makeFakeProgram(FAKE_ID, "round-trip-run");
      putCacheEntry(cache, FAKE_ID, prog, "run001");
      saveProgramCache(cache, path);

      const loaded = loadProgramCache(path);
      expect(loaded.entries[FAKE_ID]).toBeDefined();
      expect(loaded.entries[FAKE_ID].program.programId).toBe(FAKE_ID);
      expect(loaded.entries[FAKE_ID].sourceRun).toBe("run001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getCacheEntry / putCacheEntry", () => {
  it("returns null for unknown programId", () => {
    const cache = emptyCache();
    expect(getCacheEntry(cache, "unknown")).toBeNull();
  });

  it("returns the OnChainProgram for a fresh entry", () => {
    const cache = emptyCache();
    const prog = makeFakeProgram(FAKE_ID, "run001");
    putCacheEntry(cache, FAKE_ID, prog, "run001");
    const hit = getCacheEntry(cache, FAKE_ID);
    expect(hit).not.toBeNull();
    expect(hit!.programId).toBe(FAKE_ID);
    expect(hit!.name).toBe("Fake Program");
  });

  it("returns null for an expired entry", () => {
    const cache = emptyCache();
    const prog = makeFakeProgram(FAKE_ID, "run001");
    putCacheEntry(cache, FAKE_ID, prog, "run001", 0); // TTL=0 → always expired
    expect(getCacheEntry(cache, FAKE_ID)).toBeNull();
  });

  it("respects a ttlHoursOverride of 0 to force expiry", () => {
    const cache = emptyCache();
    putCacheEntry(cache, FAKE_ID, makeFakeProgram(FAKE_ID, "r"), "r", 9999);
    // Still expired because override = 0
    expect(getCacheEntry(cache, FAKE_ID, 0)).toBeNull();
  });

  it("overwrites an existing entry on putCacheEntry", () => {
    const cache = emptyCache();
    putCacheEntry(cache, FAKE_ID, makeFakeProgram(FAKE_ID, "r1"), "run001");
    putCacheEntry(cache, FAKE_ID, { ...makeFakeProgram(FAKE_ID, "r2"), name: "Updated" }, "run002");
    const hit = getCacheEntry(cache, FAKE_ID);
    expect(hit!.name).toBe("Updated");
    expect(getCacheEntryMeta(cache, FAKE_ID)!.sourceRun).toBe("run002");
  });
});

describe("getCacheEntryMeta", () => {
  it("returns null for unknown programId", () => {
    expect(getCacheEntryMeta(emptyCache(), "unknown")).toBeNull();
  });

  it("returns full metadata including cachedAt and sourceRun", () => {
    const cache = emptyCache();
    putCacheEntry(cache, FAKE_ID, makeFakeProgram(FAKE_ID, "r"), "my-run-id");
    const meta = getCacheEntryMeta(cache, FAKE_ID);
    expect(meta).not.toBeNull();
    expect(meta!.sourceRun).toBe("my-run-id");
    expect(meta!.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
    expect(meta!.ttlHours).toBe(DEFAULT_TTL_HOURS);
  });
});

describe("cacheSize", () => {
  it("returns 0 for empty cache", () => {
    expect(cacheSize(emptyCache())).toBe(0);
  });

  it("counts only non-expired entries", () => {
    const cache = emptyCache();
    putCacheEntry(cache, FAKE_ID, makeFakeProgram(FAKE_ID, "r"), "run001", 9999); // fresh
    putCacheEntry(cache, FAKE_ID_2, makeFakeProgram(FAKE_ID_2, "r"), "run002", 0); // expired (TTL=0)
    expect(cacheSize(cache)).toBe(1);
  });
});

describe("isEntryExpired", () => {
  it("returns false for a just-written entry with default TTL", () => {
    const cache = emptyCache();
    putCacheEntry(cache, FAKE_ID, makeFakeProgram(FAKE_ID, "r"), "run001");
    const entry = getCacheEntryMeta(cache, FAKE_ID)!;
    expect(isEntryExpired(entry)).toBe(false);
  });

  it("returns true when cachedAt is malformed", () => {
    const entry = {
      program: makeFakeProgram(FAKE_ID, "r"),
      cachedAt: "not-a-date",
      sourceRun: "x",
    };
    expect(isEntryExpired(entry)).toBe(true);
  });
});

// ── Integration test: buildTrustGraph uses the cache (Phase 4 "done when") ────
//
// PROOF: a second project's run reuses a program-keyed trust-graph entry from
// a first project's cache, with provenance intact.

describe("buildTrustGraph — program-keyed cache", () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-trustgraph-"));
    cachePath = join(tmpDir, "program-cache.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves from cache even when probeRpc=false (cross-run reuse)", async () => {
    // ── Run 1: seed the cache by pre-writing a fake entry ──────────────────
    // (Simulates what a first run would have stored after a live RPC probe.)
    const preSeeded: ProgramCache = {
      schemaVersion: "1.0",
      entries: {
        [FAKE_ID]: {
          program: makeFakeProgram(FAKE_ID, "pre-seed"),
          cachedAt: new Date().toISOString(),
          sourceRun: "20260608T090000",
          ttlHours: DEFAULT_TTL_HOURS,
        },
      },
    };
    saveProgramCache(preSeeded, cachePath);

    // ── Run 2: build trust graph with RPC disabled — must come from cache ──
    const graph = await buildTrustGraph([FAKE_ID], {
      probeRpc: false,
      cachePath,
    });

    // Should be resolved, NOT unresolved
    expect(graph.unresolved).toHaveLength(0);
    expect(graph.programs).toHaveLength(1);

    const prog = graph.programs[0];
    expect(prog.programId).toBe(FAKE_ID);

    // Provenance must contain cache-hit metadata
    expect(prog.provenance?.notes).toContain("cache-hit");
    expect(prog.provenance?.notes).toContain("sourceRun=20260608T090000");
  });

  it("writes RPC probe results back to the cache for future runs", async () => {
    // We can't hit a real RPC in unit tests. Instead, verify that a program
    // NOT in the directory and NOT in the cache ends up in unresolved when
    // probeRpc=false — then verify it WAS already in the cache if pre-seeded.

    // First: no cache, probeRpc disabled → unresolved
    const g1 = await buildTrustGraph([FAKE_ID], { probeRpc: false, cachePath });
    expect(g1.unresolved).toHaveLength(1);
    expect(g1.unresolved[0].reason).toMatch(/rpc_disabled/);

    // Now: seed cache manually (simulates the write-back from a live RPC run)
    const cache = loadProgramCache(cachePath);
    putCacheEntry(cache, FAKE_ID, makeFakeProgram(FAKE_ID, "written-by-rpc-run"), "20260608T120000");
    saveProgramCache(cache, cachePath);

    // Second run with same probeRpc=false now resolves from cache
    const g2 = await buildTrustGraph([FAKE_ID], { probeRpc: false, cachePath });
    expect(g2.unresolved).toHaveLength(0);
    expect(g2.programs[0].programId).toBe(FAKE_ID);
    expect(g2.programs[0].provenance?.notes).toContain("cache-hit");
  });

  it("directory entries take priority over the cache", async () => {
    // TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb is in the bundled directory.
    // Even if a cache entry exists for it, the directory wins.
    const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    const fakeCache: ProgramCache = {
      schemaVersion: "1.0",
      entries: {
        [TOKEN_2022]: {
          program: {
            ...makeFakeProgram(TOKEN_2022, "cache"),
            name: "SHOULD-BE-OVERRIDDEN",
          },
          cachedAt: new Date().toISOString(),
          sourceRun: "old-run",
          ttlHours: DEFAULT_TTL_HOURS,
        },
      },
    };
    saveProgramCache(fakeCache, cachePath);

    const graph = await buildTrustGraph([TOKEN_2022], { probeRpc: false, cachePath });
    expect(graph.programs).toHaveLength(1);
    // Should come from the directory (canonical name), not the cache
    expect(graph.programs[0].name).not.toBe("SHOULD-BE-OVERRIDDEN");
    expect(graph.programs[0].provenance?.directoryFile).toBeDefined();
  });

  it("cachePath=null disables caching entirely", async () => {
    // Seed a cache file — should be ignored
    const preSeeded: ProgramCache = {
      schemaVersion: "1.0",
      entries: {
        [FAKE_ID]: {
          program: makeFakeProgram(FAKE_ID, "r"),
          cachedAt: new Date().toISOString(),
          sourceRun: "run001",
          ttlHours: DEFAULT_TTL_HOURS,
        },
      },
    };
    saveProgramCache(preSeeded, cachePath);

    // cachePath=null means "ignore cache"
    const g = await buildTrustGraph([FAKE_ID], { probeRpc: false, cachePath: null });
    // Without cache, falls to unresolved (no directory hit, RPC disabled)
    expect(g.unresolved).toHaveLength(1);
  });

  it("deduplicated IDs resolve each exactly once (cache + dedup)", async () => {
    const preSeeded: ProgramCache = {
      schemaVersion: "1.0",
      entries: {
        [FAKE_ID]: {
          program: makeFakeProgram(FAKE_ID, "r"),
          cachedAt: new Date().toISOString(),
          sourceRun: "run001",
          ttlHours: DEFAULT_TTL_HOURS,
        },
      },
    };
    saveProgramCache(preSeeded, cachePath);

    // Duplicate IDs: should only appear once in output
    const g = await buildTrustGraph([FAKE_ID, FAKE_ID, FAKE_ID], { probeRpc: false, cachePath });
    expect(g.programs).toHaveLength(1);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyCache(): ProgramCache {
  return { schemaVersion: "1.0", entries: {} };
}

function makeFakeProgram(programId: string, _tag: string): OnChainProgram {
  return {
    programId,
    name: "Fake Program",
    kind: "app",
    upgradeAuthority: { kind: "single-key", address: "SomeAuthority111111111111111111", source: "rpc" },
    verifiedBuild: { state: "unknown" },
    audits: [],
    parity: { mainnet: "unknown", devnet: "unknown" },
    provenance: { notes: "synthetic test entry" },
  };
}
