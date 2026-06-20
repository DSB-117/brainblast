import { loadDirectory } from "./directory.ts";
import { probeUpgradeAuthority, type RpcOpts } from "./rpc.ts";
import { enrichAuthorityClassification } from "./classifyAuthority.ts";
import {
  loadProgramCache,
  saveProgramCache,
  getCacheEntry,
  getCacheEntryMeta,
  putCacheEntry,
} from "./programCache.ts";
import type { OnChainProgram, TrustGraph, UpgradeAuthority } from "./types.ts";

export interface BuildOpts extends RpcOpts {
  // If false, skip live RPC probes entirely. Useful for offline runs and
  // tests; programs not in the directory AND not in the cache will be
  // marked unresolved with reason="not_in_directory_or_cache_and_rpc_disabled".
  probeRpc?: boolean;
  // When true (default), a freshly RPC-probed authority that resolved to an
  // address but couldn't be classified is enriched with one more getAccountInfo
  // on the authority account — turning "unknown" into single-key / multisig /
  // dao by reading its owner program (v0.7.4). Set false to skip the extra call.
  classifyAuthority?: boolean;
  // Override the directory file (tests).
  directoryPath?: string;
  // Path to the program-keyed disk cache.
  // Defaults to ~/.brainblast/program-cache.json (or BRAINBLAST_CACHE_PATH env).
  // Set to null to disable caching entirely for this run.
  cachePath?: string | null;
}

// Compose a trust graph for a set of program IDs.
//
// Source-of-truth order:
//   1. Curated directory (programs/directory.yaml) — full record, never
//      overridden by cache or RPC.
//   2. Program cache (~/.brainblast/program-cache.json) — a previous run's
//      live-probed data, subject to TTL (default 1 week). Cross-project:
//      a program researched for Project A pre-populates Project B's run.
//   3. Live RPC probe (probeUpgradeAuthority) — fills in upgradeAuthority
//      only; everything else stays unknown until research enriches it. New
//      results are written back to the cache for future runs.
//
// The function is deterministic given its inputs: same directory + same cache
// + same RPC responses = same TrustGraph (modulo generatedAt + checkedAt).
export async function buildTrustGraph(programIds: string[], opts: BuildOpts = {}): Promise<TrustGraph> {
  const dir = loadDirectory(opts.directoryPath);
  const programs: OnChainProgram[] = [];
  const unresolved: TrustGraph["unresolved"] = [];

  // Load (or create) the persistent program cache unless explicitly disabled.
  const cacheEnabled = opts.cachePath !== null;
  const cachePathArg = opts.cachePath === null ? undefined : opts.cachePath;
  const cache = cacheEnabled ? loadProgramCache(cachePathArg) : null;

  // Track which program IDs we probed from RPC so we can write them back.
  const newFromRpc: string[] = [];

  // Stable run ID matches emit.ts format: 14-digit YYYYMMDDHHMMSS.
  const runId = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  // Deduplicate and preserve caller order.
  const seen = new Set<string>();
  const ordered = programIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));

  for (const id of ordered) {
    // ── 1. Curated directory ───────────────────────────────────────────────
    const directoryHit = dir.get(id);
    if (directoryHit) {
      programs.push(directoryHit);
      continue;
    }

    // ── 2. Program cache ───────────────────────────────────────────────────
    if (cache) {
      const cached = getCacheEntry(cache, id);
      if (cached) {
        const meta = getCacheEntryMeta(cache, id)!;
        // Stamp the program with provenance so downstream consumers know it
        // came from cache and when it was originally researched.
        programs.push({
          ...cached,
          provenance: {
            ...(cached.provenance ?? {}),
            notes: [
              cached.provenance?.notes,
              `cache-hit: cachedAt=${meta.cachedAt} sourceRun=${meta.sourceRun}`,
            ]
              .filter(Boolean)
              .join("; "),
          },
        });
        continue;
      }
    }

    // ── 3. Live RPC probe ──────────────────────────────────────────────────
    if (opts.probeRpc === false) {
      unresolved.push({
        programId: id,
        reason: "not_in_directory_or_cache_and_rpc_disabled",
      });
      continue;
    }

    let authority: UpgradeAuthority;
    try {
      authority = await probeUpgradeAuthority(id, opts);
      // Live classification: read the authority account's owner to resolve
      // single-key vs multisig vs DAO. Best-effort — a failure here must not
      // sink the whole program, so we keep the (unclassified) authority.
      if (opts.classifyAuthority !== false) {
        try {
          authority = await enrichAuthorityClassification(authority, opts);
        } catch {
          /* keep the unclassified authority */
        }
      }
    } catch (e: any) {
      unresolved.push({ programId: id, reason: `rpc_error: ${e?.message ?? String(e)}` });
      continue;
    }

    const probed: OnChainProgram = {
      programId: id,
      name: `Unknown program (${id.slice(0, 8)}…)`,
      kind: "app",
      upgradeAuthority: authority,
      verifiedBuild: { state: "unknown" },
      audits: [],
      parity: { mainnet: "unknown", devnet: "unknown" },
      provenance: { rpcUrl: opts.rpcUrl, notes: "live-probed; not in curated directory" },
    };

    programs.push(probed);
    newFromRpc.push(id);

    // Write back to cache for future runs.
    if (cache) {
      putCacheEntry(cache, id, probed, runId);
    }
  }

  // Persist cache updates (only if we learned something new this run).
  if (cache && newFromRpc.length > 0) {
    saveProgramCache(cache, cachePathArg);
  }

  return { programs, unresolved, generatedAt: new Date().toISOString() };
}
