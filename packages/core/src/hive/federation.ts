// HiveMind federation — the wire protocol for cross-machine and team hives.
//
// A **space** is a shared channel of experience events. Its id is a
// high-entropy capability: knowing the id IS membership (read + contribute),
// exactly like an unguessable invite link — no accounts, no server-side
// member management, no human in the issuance path (North Star #1's self-serve
// discipline applied to sharing). What the id does NOT grant is impersonation:
// every pushed batch is ed25519-signed by its author's hive identity, so
// events are attributable and a leaked id can't forge a teammate's history.
//
// Trust boundary, stated plainly: anyone holding a space id can read the
// space's fix metadata (rule ids, repo names, relative file paths, details)
// and contribute events under their OWN identity. Share a space id the way
// you'd share a private invite link. Experience is advisory context — it
// never enters the RED→GREEN-gated corpus or the enforcement rule set.
//
// PURE module (node:crypto + base58 + canonicalJson only): the registry
// vendors this file for its /api/hive/experience route; fs-bound pieces
// (identity file, spaces file, JSONL store, sync client) live in
// identity.ts / spaces.ts.

import { createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { base58Decode, base58Encode } from "../base58.ts";
import { canonicalJson } from "../marketplace.ts";
import type { ExperienceEvent } from "./experience.ts";

// ── ed25519 sign/verify over canonical JSON (grant-style trust model) ────────

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function privFromSeed(seed: Buffer) {
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}
function pubFromBytes(pub: Buffer) {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pub]), format: "der", type: "spki" });
}

export function signBody(secretKeyB58: string, body: unknown): string {
  const seed = base58Decode(secretKeyB58).subarray(0, 32);
  return base58Encode(cryptoSign(null, Buffer.from(canonicalJson(body)), privFromSeed(seed)));
}

export function verifyBody(addressB58: string, body: unknown, sigB58: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(canonicalJson(body)), pubFromBytes(base58Decode(addressB58)), base58Decode(sigB58));
  } catch {
    return false;
  }
}

// ── Spaces ───────────────────────────────────────────────────────────────────

export const SPACE_ID_PREFIX = "hs_";

// 24 random bytes ≈ 192 bits of entropy — unguessable by construction.
export function newSpaceId(): string {
  return SPACE_ID_PREFIX + base58Encode(randomBytes(24));
}

export function isSpaceId(id: unknown): id is string {
  return typeof id === "string" && /^hs_[1-9A-HJ-NP-Za-km-z]{25,44}$/.test(id);
}

// ── Signed experience batches (the push payload) ─────────────────────────────

export const BATCH_MAX_EVENTS = 500;
export const EVENT_FIELD_MAX = 2000; // per-string-field cap — details, paths, names

export interface ExperienceBatchBody {
  batchVersion: "1.0";
  space: string; // bound into the signature — a batch can't be replayed into another space
  author: string; // base58 ed25519 address of the contributing hive
  sentAt: string;
  events: ExperienceEvent[];
}

export interface ExperienceBatch extends ExperienceBatchBody {
  sig: string; // base58 ed25519 signature over canonicalJson(body-without-sig)
}

export function makeBatch(
  secretKeyB58: string,
  author: string,
  space: string,
  events: ExperienceEvent[],
  sentAt: string = new Date().toISOString(),
): ExperienceBatch {
  const body: ExperienceBatchBody = { batchVersion: "1.0", space, author, sentAt, events };
  return { ...body, sig: signBody(secretKeyB58, body) };
}

export interface BatchVerification {
  valid: boolean;
  reason?: "malformed" | "bad-space" | "too-many-events" | "oversized-event" | "bad-signature";
}

function eventShapeOk(e: any): boolean {
  if (!e || typeof e !== "object") return false;
  for (const k of ["ruleId", "repoPath", "repoName", "file", "exportName", "fixedAt", "detail"]) {
    if (typeof e[k] !== "string" || e[k].length > EVENT_FIELD_MAX) return false;
  }
  return e.ruleId.length > 0;
}

// Self-consistent verification: the batch's signature must verify against the
// author key INSIDE the signed body. There is no allowlist — the space id is
// the membership check (enforced by the transport header matching the signed
// `space`), the signature is the attribution check.
export function verifyBatch(batch: ExperienceBatch): BatchVerification {
  if (!batch || typeof batch !== "object" || typeof batch.sig !== "string") return { valid: false, reason: "malformed" };
  if (batch.batchVersion !== "1.0" || typeof batch.author !== "string" || typeof batch.sentAt !== "string") {
    return { valid: false, reason: "malformed" };
  }
  if (!isSpaceId(batch.space)) return { valid: false, reason: "bad-space" };
  if (!Array.isArray(batch.events) || batch.events.length === 0) return { valid: false, reason: "malformed" };
  if (batch.events.length > BATCH_MAX_EVENTS) return { valid: false, reason: "too-many-events" };
  if (!batch.events.every(eventShapeOk)) return { valid: false, reason: "oversized-event" };
  const { sig, ...body } = batch;
  if (!verifyBody(batch.author, body, sig)) return { valid: false, reason: "bad-signature" };
  return { valid: true };
}

// ── The server-side store seam ───────────────────────────────────────────────

// An event as the server hands it back: attributed and sequenced. `seq` is the
// pull cursor — strictly increasing per space, assigned at insert.
export interface StoredExperienceEvent extends ExperienceEvent {
  author: string;
  seq: number;
}

export function experienceEventKey(e: { ruleId: string; repoPath: string; file: string; exportName: string; fixedAt: string }): string {
  return `${e.ruleId}::${e.repoPath}::${e.file}::${e.exportName}::${e.fixedAt}`;
}

export interface HiveStoreAppendResult {
  accepted: number;
  duplicates: number;
  total: number; // events in the space after the append
}

export interface HiveExperienceStore {
  append(space: string, author: string, events: ExperienceEvent[]): HiveStoreAppendResult | Promise<HiveStoreAppendResult>;
  list(space: string, sinceSeq?: number): { events: StoredExperienceEvent[]; cursor: number } | Promise<{ events: StoredExperienceEvent[]; cursor: number }>;
}

// In-memory store: the reference implementation of the merge semantics
// (idempotent by author+eventKey, monotonic seq). Used by tests and as the
// executable spec the JSONL (serve) and Supabase (registry) stores mirror.
export class MemoryHiveStore implements HiveExperienceStore {
  private spaces = new Map<string, { seq: number; byKey: Map<string, StoredExperienceEvent> }>();

  append(space: string, author: string, events: ExperienceEvent[]): HiveStoreAppendResult {
    const s = this.spaces.get(space) ?? { seq: 0, byKey: new Map() };
    this.spaces.set(space, s);
    let accepted = 0;
    let duplicates = 0;
    for (const e of events) {
      const key = `${author}::${experienceEventKey(e)}`;
      if (s.byKey.has(key)) {
        duplicates++;
        continue;
      }
      s.seq += 1;
      s.byKey.set(key, { ...e, author, seq: s.seq });
      accepted++;
    }
    return { accepted, duplicates, total: s.byKey.size };
  }

  list(space: string, sinceSeq = 0): { events: StoredExperienceEvent[]; cursor: number } {
    const s = this.spaces.get(space);
    if (!s) return { events: [], cursor: sinceSeq };
    const events = [...s.byKey.values()].filter((e) => e.seq > sinceSeq).sort((a, b) => a.seq - b.seq);
    return { events, cursor: events.length ? events[events.length - 1].seq : sinceSeq };
  }
}

// PostgREST-backed store for the hosted registry (no SDK dependency — plain
// fetch, same pattern as SupabaseVtiStore in contrib/store.ts). Table:
//
//   create table hive_experience (
//     seq        bigint generated always as identity primary key,
//     space      text not null,
//     author     text not null,
//     event_key  text not null,
//     received_at timestamptz not null default now(),
//     event      jsonb not null,
//     unique (space, author, event_key)
//   );
//   create index on hive_experience (space, seq);
export class SupabaseHiveStore implements HiveExperienceStore {
  constructor(
    private url: string,
    private serviceKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceKey,
      authorization: `Bearer ${this.serviceKey}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  async append(space: string, author: string, events: ExperienceEvent[]): Promise<HiveStoreAppendResult> {
    const rows = events.map((e) => ({ space, author, event_key: experienceEventKey(e), event: e }));
    // ignore-duplicates upsert on the (space, author, event_key) unique key —
    // DB-level idempotency, like the VTI store.
    const res = await this.fetchImpl(`${this.url}/rest/v1/hive_experience?on_conflict=space,author,event_key`, {
      method: "POST",
      headers: this.headers({ prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`hive store append failed: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
    const inserted = (await res.json()) as unknown[];
    const countRes = await this.fetchImpl(
      `${this.url}/rest/v1/hive_experience?space=eq.${encodeURIComponent(space)}&select=seq`,
      { method: "HEAD", headers: this.headers({ prefer: "count=exact" }) },
    );
    const total = Number(countRes.headers.get("content-range")?.split("/")[1] ?? 0);
    return { accepted: inserted.length, duplicates: events.length - inserted.length, total };
  }

  async list(space: string, sinceSeq = 0): Promise<{ events: StoredExperienceEvent[]; cursor: number }> {
    const res = await this.fetchImpl(
      `${this.url}/rest/v1/hive_experience?space=eq.${encodeURIComponent(space)}&seq=gt.${sinceSeq}&order=seq.asc&limit=1000&select=seq,author,event`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`hive store list failed: ${res.status}`);
    const rows = (await res.json()) as { seq: number; author: string; event: ExperienceEvent }[];
    const events = rows.map((r) => ({ ...r.event, author: r.author, seq: r.seq }));
    return { events, cursor: events.length ? events[events.length - 1].seq : sinceSeq };
  }
}
