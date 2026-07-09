// HiveMind watch — the always-on loop that makes the hive a REAL-TIME second
// brain instead of a snapshot you remember to refresh.
//
// One daemon, three jobs per tick:
//   1. Pull the VTI feed delta + federate every joined space (cheap: cursor
//      deltas, a couple of requests).
//   2. Surface outbreaks the moment a new trap lands that touches a linked
//      repo's dependencies.
//   3. Re-inject the CLAUDE.md/AGENTS.md briefing block in every linked repo
//      that carries one, so the NEXT agent session anywhere on the machine
//      picks up knowledge that arrived seconds ago — no human in the loop.
//
// The pack mirror re-checks on a longer interval (it's sha-skipped and cheap,
// but the GitHub commit-resolution API is rate-limited per hour). Every leg is
// fail-open: an unreachable remote logs and the loop keeps breathing.

import { existsSync, readFileSync } from "node:fs";
import { syncFeed, syncPacks, type SyncFeedReport } from "./sync.ts";
import { loadSpaces, syncAllSpaces, type SpaceSyncReport } from "./spaces.ts";
import { loadExperience, loadLocalExperience } from "./experience.ts";
import { loadHiveLot, loadRepos, loadCursor } from "./store.ts";
import { assembleBrief, renderBriefMarkdown } from "./brief.ts";
import { agentInstructionFile, injectBlock, HIVE_BLOCK_BEGIN } from "./inject.ts";
import { extractRepoDeps } from "./repos.ts";
import { renderOutbreakText } from "./outbreak.ts";

export interface HiveWatchOptions {
  root: string;
  remote?: string;
  grantPath?: string;
  intervalMs?: number; // feed + federation cadence (default 60s)
  packsIntervalMs?: number; // pack mirror cadence (default 15min)
  longPollSec?: number; // push-transport hold per space (default 25s; 0 disables)
  disablePushLoop?: boolean; // tests drive ticks by hand
  log?: (line: string) => void;
  fetchImpl?: any; // injectable for tests (threaded to sync/spaces)
}

export interface HiveWatchHandle {
  stop(): void;
  tick(): Promise<void>; // exposed for tests — one full cycle on demand
}

// Refresh the injected briefing block in every linked repo that already has
// one (a repo without the marker is never touched — injection stays opt-in).
export function refreshInjectedBriefs(root: string, log: (l: string) => void = () => {}): number {
  let refreshed = 0;
  const vtis = loadHiveLot(root);
  const experience = loadExperience(root);
  const cursor = loadCursor(root);
  for (const repo of loadRepos(root).repos) {
    try {
      const file = agentInstructionFile(repo.path);
      if (!existsSync(file) || !readFileSync(file, "utf8").includes(HIVE_BLOCK_BEGIN)) continue;
      const { deps } = extractRepoDeps(repo.path);
      const brief = assembleBrief({ deps, vtis, experience });
      const action = injectBlock(file, renderBriefMarkdown(brief, { syncedAt: cursor.lastSyncAt, tier: cursor.tier }));
      if (action !== "unchanged") {
        refreshed++;
        log(`hive watch: briefing refreshed in ${repo.name} (${brief.totalMatched} matching traps)`);
      }
    } catch {
      // one unwritable repo never stops the loop
    }
  }
  return refreshed;
}

export function startHiveWatch(opts: HiveWatchOptions): HiveWatchHandle {
  const log = opts.log ?? ((l: string) => console.error(l));
  const intervalMs = Math.max(10_000, opts.intervalMs ?? 60_000);
  const packsIntervalMs = Math.max(intervalMs, opts.packsIntervalMs ?? 15 * 60_000);
  let lastPacksAt = 0;
  let inflight: Promise<void> | null = null;
  let stopped = false;

  // Overlap-safe AND awaitable: a tick requested while one is running joins
  // the in-flight cycle instead of stacking or silently no-oping.
  function tick(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (inflight) return inflight;
    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function run(): Promise<void> {
    let changed = false;
    {
      // Feed delta — the corpus's newest proven traps.
      try {
        const feed: SyncFeedReport = await syncFeed({
          root: opts.root,
          remote: opts.remote,
          grantPath: opts.grantPath,
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        });
        if (feed.added || feed.updated) {
          changed = true;
          log(`hive watch: +${feed.added} new trap${feed.added === 1 ? "" : "s"}, ${feed.updated} enriched (brain: ${feed.total})`);
        }
        for (const o of feed.outbreaks) log(`hive watch: ${renderOutbreakText(o)}`);
      } catch (e: any) {
        log(`hive watch: feed sync failed (will retry): ${e?.message ?? e}`);
      }

      // Federation on the interval loop pushes our fixes + does a quick
      // (non-blocking) pull. The near-INSTANT team delivery happens on the
      // separate long-poll loop below; this leg guarantees our own new fix
      // events reach the swarm each interval even if the long-poll is mid-hold.
      if (loadSpaces(opts.root).spaces.length) {
        const reports: SpaceSyncReport[] = await syncAllSpaces(
          opts.root,
          loadLocalExperience(opts.root),
          opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {},
        );
        for (const r of reports) {
          if (r.error) log(`hive watch: space ${r.name ?? r.space.slice(0, 12) + "…"} failed (will retry): ${r.error}`);
          else if (r.pushed || r.pulled) {
            changed = true;
            log(`hive watch: space ${r.name ?? r.space.slice(0, 12) + "…"} — pushed ${r.pushed}, pulled ${r.pulled}`);
          }
        }
      }

      // Pack mirror — enforcement rules, on the slower cadence.
      if (Date.now() - lastPacksAt >= packsIntervalMs) {
        lastPacksAt = Date.now();
        try {
          const packs = await syncPacks({ root: opts.root, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
          if (!packs.skipped) {
            changed = true;
            log(`hive watch: packs → ${packs.repo}@${packs.sha.slice(0, 12)} (${packs.packs} packs)`);
          }
        } catch (e: any) {
          log(`hive watch: pack mirror failed (will retry): ${e?.message ?? e}`);
        }
      }

      // Knowledge moved → refresh every injected briefing on the machine.
      if (changed) refreshInjectedBriefs(opts.root, log);
    }
  }

  // The push-transport loop: long-poll each joined space back-to-back, so a
  // teammate's fix lands here within ~a second of them running sync — not on
  // the next interval tick. Runs independently of the feed/packs cadence.
  const waitSec = Math.max(0, Math.min(30, opts.longPollSec ?? 25));
  async function pushLoop(): Promise<void> {
    while (!stopped && waitSec > 0) {
      const spaces = loadSpaces(opts.root).spaces;
      if (spaces.length === 0) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      try {
        const reports = await syncAllSpaces(opts.root, loadLocalExperience(opts.root), {
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          waitSec,
        });
        let pulled = 0;
        for (const r of reports) {
          if (r.error) {
            // back off a beat on error so a down remote doesn't hot-loop
            await new Promise((res) => setTimeout(res, Math.min(intervalMs, 5000)));
          } else if (r.pulled) {
            pulled += r.pulled;
            log(`hive watch: space ${r.name ?? r.space.slice(0, 12) + "…"} — pulled ${r.pulled} (push)`);
          }
        }
        if (pulled) refreshInjectedBriefs(opts.root, log);
      } catch (e: any) {
        log(`hive watch: push loop error (will retry): ${e?.message ?? e}`);
        await new Promise((res) => setTimeout(res, Math.min(intervalMs, 5000)));
      }
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  void tick(); // first cycle immediately — a watcher that waits a minute to start isn't real-time
  if (waitSec > 0 && !opts.disablePushLoop) void pushLoop();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}
