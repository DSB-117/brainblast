// HiveMind spaces — the fs + client half of federation (protocol in
// federation.ts). A machine joins any number of spaces; `hive sync` then
// pushes its local fix events to each and pulls everyone else's, so your
// laptop, your desktop, your CI runner — and, with a shared space id, your
// whole team — converge on one experience log.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REGISTRY_URL } from "../telemetry.ts";
import {
  experienceEventKey,
  isSpaceId,
  makeBatch,
  newSpaceId,
  type ExperienceBatch,
  type HiveExperienceStore,
  type HiveStoreAppendResult,
  type StoredExperienceEvent,
} from "./federation.ts";
import { loadOrCreateIdentity } from "./identity.ts";
import { loadSharedExperience, sharedExperiencePath, type ExperienceEvent } from "./experience.ts";

export const DEFAULT_FEDERATION_REMOTE = `${DEFAULT_REGISTRY_URL}/api`;

// ── Joined spaces (spaces.json) ──────────────────────────────────────────────

export interface JoinedSpace {
  id: string;
  name?: string;
  remote: string; // endpoint base serving /hive/experience
  joinedAt: string;
  cursor: number; // last pulled seq
}

export interface HiveSpaces {
  schemaVersion: "1.0";
  spaces: JoinedSpace[];
}

export function spacesPath(root: string): string {
  return join(root, "spaces.json");
}

export function loadSpaces(root: string): HiveSpaces {
  const p = spacesPath(root);
  if (!existsSync(p)) return { schemaVersion: "1.0", spaces: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return {
      schemaVersion: "1.0",
      spaces: Array.isArray(parsed.spaces) ? parsed.spaces.filter((s: any) => isSpaceId(s?.id)) : [],
    };
  } catch {
    return { schemaVersion: "1.0", spaces: [] };
  }
}

export function saveSpaces(root: string, spaces: HiveSpaces): void {
  mkdirSync(root, { recursive: true });
  // A space id is a capability — keep the file owner-only, like identity.json.
  writeFileSync(spacesPath(root), JSON.stringify(spaces, null, 2), { mode: 0o600 });
}

export function createSpace(root: string, opts: { name?: string; remote?: string; now?: string } = {}): JoinedSpace {
  const space: JoinedSpace = {
    id: newSpaceId(),
    ...(opts.name ? { name: opts.name } : {}),
    remote: (opts.remote ?? DEFAULT_FEDERATION_REMOTE).replace(/\/+$/, ""),
    joinedAt: opts.now ?? new Date().toISOString(),
    cursor: 0,
  };
  const state = loadSpaces(root);
  state.spaces.push(space);
  saveSpaces(root, state);
  return space;
}

export function joinSpace(root: string, id: string, opts: { name?: string; remote?: string; now?: string } = {}): JoinedSpace {
  if (!isSpaceId(id)) throw new Error(`hive space: '${id}' is not a valid space id (hs_…)`);
  const state = loadSpaces(root);
  const existing = state.spaces.find((s) => s.id === id);
  if (existing) return existing;
  const space: JoinedSpace = {
    id,
    ...(opts.name ? { name: opts.name } : {}),
    remote: (opts.remote ?? DEFAULT_FEDERATION_REMOTE).replace(/\/+$/, ""),
    joinedAt: opts.now ?? new Date().toISOString(),
    cursor: 0,
  };
  state.spaces.push(space);
  saveSpaces(root, state);
  return space;
}

export function leaveSpace(root: string, id: string): boolean {
  const state = loadSpaces(root);
  const before = state.spaces.length;
  state.spaces = state.spaces.filter((s) => s.id !== id);
  if (state.spaces.length === before) return false;
  saveSpaces(root, state);
  return true;
}

// ── The shared experience log (what pull merges into) ────────────────────────

export function mergeSharedEvents(root: string, incoming: StoredExperienceEvent[], selfAddress: string): number {
  const existing = loadSharedExperience(root);
  const seen = new Set(existing.map((e) => `${e.author ?? ""}::${experienceEventKey(e)}`));
  const fresh: (ExperienceEvent & { author: string })[] = [];
  for (const e of incoming) {
    if (e.author === selfAddress) continue; // our own events already live in experience.jsonl
    const { seq, ...rest } = e;
    const key = `${e.author}::${experienceEventKey(e)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(rest);
  }
  if (fresh.length) {
    mkdirSync(root, { recursive: true });
    appendFileSync(sharedExperiencePath(root), fresh.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return fresh.length;
}

// ── JSONL-backed server store (what `brainblast serve` hosts) ────────────────
//
// Same merge semantics as MemoryHiveStore (the executable spec), persisted as
// one JSONL line per stored event.

export class JsonlHiveStore implements HiveExperienceStore {
  constructor(private file: string) {}

  private read(): { space: string; author: string; seq: number; event: ExperienceEvent }[] {
    if (!existsSync(this.file)) return [];
    const out: { space: string; author: string; seq: number; event: ExperienceEvent }[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed.space === "string" && typeof parsed.seq === "number") out.push(parsed);
      } catch {
        // tolerated
      }
    }
    return out;
  }

  append(space: string, author: string, events: ExperienceEvent[]): HiveStoreAppendResult {
    const rows = this.read();
    const inSpace = rows.filter((r) => r.space === space);
    const seen = new Set(inSpace.map((r) => `${r.author}::${experienceEventKey(r.event)}`));
    let seq = inSpace.reduce((m, r) => Math.max(m, r.seq), 0);
    let accepted = 0;
    let duplicates = 0;
    const fresh: { space: string; author: string; seq: number; event: ExperienceEvent }[] = [];
    for (const e of events) {
      const key = `${author}::${experienceEventKey(e)}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      seq += 1;
      fresh.push({ space, author, seq, event: e });
      accepted++;
    }
    if (fresh.length) {
      mkdirSync(join(this.file, ".."), { recursive: true });
      appendFileSync(this.file, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    return { accepted, duplicates, total: inSpace.length + accepted };
  }

  list(space: string, sinceSeq = 0): { events: StoredExperienceEvent[]; cursor: number } {
    const rows = this.read()
      .filter((r) => r.space === space && r.seq > sinceSeq)
      .sort((a, b) => a.seq - b.seq);
    const events = rows.map((r) => ({ ...r.event, author: r.author, seq: r.seq }));
    return { events, cursor: events.length ? events[events.length - 1].seq : sinceSeq };
  }
}

// ── Push / pull client ───────────────────────────────────────────────────────

type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

export interface SpaceSyncReport {
  space: string;
  name?: string;
  remote: string;
  pushed: number;
  pushDuplicates: number;
  pulled: number;
  cursor: number;
  error?: string;
}

// One space, one round-trip each way. Push is fully idempotent (the server
// dedups by author+eventKey), so we always push the complete local log — no
// client-side "what have I pushed" bookkeeping to corrupt.
export async function syncSpace(
  root: string,
  space: JoinedSpace,
  localEvents: ExperienceEvent[],
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
): Promise<SpaceSyncReport> {
  const identity = loadOrCreateIdentity(root);
  const base = space.remote.replace(/\/+$/, "");
  const report: SpaceSyncReport = {
    space: space.id,
    ...(space.name ? { name: space.name } : {}),
    remote: base,
    pushed: 0,
    pushDuplicates: 0,
    pulled: 0,
    cursor: space.cursor,
  };

  if (localEvents.length) {
    const batch: ExperienceBatch = makeBatch(identity.secretKey, identity.address, space.id, localEvents.slice(0, 500));
    const res = await fetchImpl(`${base}/hive/experience`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-brainblast-space": space.id },
      body: JSON.stringify(batch),
    });
    const body = await res.text();
    if (res.status !== 200) throw new Error(`push to ${base} returned ${res.status}: ${body.trim().slice(0, 200)}`);
    const parsed = JSON.parse(body);
    report.pushed = parsed.accepted ?? 0;
    report.pushDuplicates = parsed.duplicates ?? 0;
  }

  const res = await fetchImpl(`${base}/hive/experience?since=${space.cursor}`, {
    headers: { "x-brainblast-space": space.id },
  });
  const body = await res.text();
  if (res.status !== 200) throw new Error(`pull from ${base} returned ${res.status}: ${body.trim().slice(0, 200)}`);
  const parsed = JSON.parse(body) as { events: StoredExperienceEvent[]; cursor: number };
  report.pulled = mergeSharedEvents(root, parsed.events ?? [], identity.address);
  report.cursor = typeof parsed.cursor === "number" ? parsed.cursor : space.cursor;

  // Persist the cursor only after the merge landed.
  const state = loadSpaces(root);
  const target = state.spaces.find((s) => s.id === space.id);
  if (target) {
    target.cursor = report.cursor;
    saveSpaces(root, state);
  }
  return report;
}

// All joined spaces; per-space failures are isolated into the report.
export async function syncAllSpaces(
  root: string,
  localEvents: ExperienceEvent[],
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
): Promise<SpaceSyncReport[]> {
  const reports: SpaceSyncReport[] = [];
  for (const space of loadSpaces(root).spaces) {
    try {
      reports.push(await syncSpace(root, space, localEvents, fetchImpl));
    } catch (e: any) {
      reports.push({
        space: space.id,
        ...(space.name ? { name: space.name } : {}),
        remote: space.remote,
        pushed: 0,
        pushDuplicates: 0,
        pulled: 0,
        cursor: space.cursor,
        error: e?.message ?? String(e),
      });
    }
  }
  return reports;
}
