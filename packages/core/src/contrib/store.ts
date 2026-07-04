// The store seam — "the database" behind a direct VTI submission.
//
// `ingestSubmission` decides IF a record may land; the store decides WHERE it
// lands. Keeping them separate is the whole point: the registry swaps
// `JsonlVtiStore` (local file — the reference DB) for `SupabaseVtiStore` (prod)
// and reuses the exact same validator, so a git-less write is safe by
// construction.
//
// The interface is async because a real DB is: `JsonlVtiStore` resolves
// immediately, `SupabaseVtiStore` awaits PostgREST over `fetch`.
//
// Two invariants mirror the fleet ledger's server rules:
//   - idempotent  — inserting a trapId already present is a no-op, not an error
//     (a retried POST can't duplicate a record).
//   - non-destructive — an insert never rewrites or removes another record.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface StoredVti {
  trapId: string;
  [k: string]: unknown;
}

export interface InsertResult {
  inserted: boolean;
  /** Why an insert was a no-op or rejected (already present / missing trapId). */
  reason?: string;
}

// The abstraction the registry server depends on. A Supabase implementation
// satisfies the same three methods (insert = upsert-if-absent, list = select,
// has = exists).
export interface VtiStore {
  insert(vti: StoredVti): Promise<InsertResult>;
  list(): Promise<StoredVti[]>;
  has(trapId: string): Promise<boolean>;
}

// ── Local reference store — append-only JSONL. One record per line. ──────────
export class JsonlVtiStore implements VtiStore {
  constructor(private readonly path: string) {}

  private read(): StoredVti[] {
    if (!existsSync(this.path)) return [];
    const out: StoredVti[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = JSON.parse(t);
        if (rec && typeof rec.trapId === "string") out.push(rec);
      } catch {
        // skip a corrupt line rather than fail the whole read
      }
    }
    return out;
  }

  async has(trapId: string): Promise<boolean> {
    return this.read().some((r) => r.trapId === trapId);
  }

  async list(): Promise<StoredVti[]> {
    return this.read();
  }

  async insert(vti: StoredVti): Promise<InsertResult> {
    if (!vti || typeof vti.trapId !== "string" || vti.trapId.length === 0) {
      return { inserted: false, reason: "record has no trapId" };
    }
    if (await this.has(vti.trapId)) {
      // Non-destructive + idempotent: keep the first landing, ignore the retry.
      return { inserted: false, reason: "trapId already present" };
    }
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(vti) + "\n", "utf8");
    return { inserted: true };
  }
}

// ── Production store — Supabase via PostgREST (dependency-free, over fetch). ──
//
// Talks to Supabase the same way the rest of the codebase talks to the registry:
// plain `fetch`, no SDK. Requires a table (see the migration in
// `datasets/contrib/README.md`):
//
//   create table vtis (
//     trap_id    text primary key,
//     record     jsonb not null,
//     created_at timestamptz not null default now()
//   );
//
// The service-role key is a SERVER secret — this class is instantiated only by
// the registry (never shipped to a client). Idempotency is enforced by the
// primary key + `Prefer: resolution=ignore-duplicates`, so a duplicate POST is a
// no-op at the database, not just in app code.
export interface SupabaseStoreConfig {
  url: string; // https://<project>.supabase.co
  key: string; // service-role key (server secret)
  table?: string; // default "vtis"
  fetchImpl?: typeof fetch; // injectable for tests
}

export class SupabaseVtiStore implements VtiStore {
  private readonly base: string;
  private readonly table: string;
  private readonly headers: Record<string, string>;
  private readonly f: typeof fetch;

  constructor(cfg: SupabaseStoreConfig) {
    this.base = cfg.url.replace(/\/+$/, "");
    this.table = cfg.table ?? "vtis";
    this.f = cfg.fetchImpl ?? fetch;
    this.headers = {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
    };
  }

  private rest(path: string): string {
    return `${this.base}/rest/v1/${this.table}${path}`;
  }

  async has(trapId: string): Promise<boolean> {
    const res = await this.f(this.rest(`?trap_id=eq.${encodeURIComponent(trapId)}&select=trap_id`), {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`supabase has() ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }

  async list(): Promise<StoredVti[]> {
    const res = await this.f(this.rest(`?select=record&order=created_at.asc`), { headers: this.headers });
    if (!res.ok) throw new Error(`supabase list() ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as { record: StoredVti }[];
    return rows.map((r) => r.record).filter((r) => r && typeof r.trapId === "string");
  }

  async insert(vti: StoredVti): Promise<InsertResult> {
    if (!vti || typeof vti.trapId !== "string" || vti.trapId.length === 0) {
      return { inserted: false, reason: "record has no trapId" };
    }
    // ignore-duplicates → a conflict on the trap_id PK returns 201 with an EMPTY
    // representation (row not written); return=representation lets us read that.
    const res = await this.f(this.rest(""), {
      method: "POST",
      headers: { ...this.headers, prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify([{ trap_id: vti.trapId, record: vti }]),
    });
    if (!res.ok) {
      return { inserted: false, reason: `supabase insert ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const rows = (await res.json().catch(() => [])) as unknown[];
    if (Array.isArray(rows) && rows.length === 0) {
      return { inserted: false, reason: "trapId already present" };
    }
    return { inserted: true };
  }
}

// Build the right store from env: Supabase when configured, else the local JSONL
// reference. `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`) →
// prod; otherwise `storePath` (default set by the server).
export function storeFromEnv(storePath: string, env: NodeJS.ProcessEnv = process.env): VtiStore {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_KEY;
  if (url && key) {
    return new SupabaseVtiStore({ url, key, table: env.BRAINBLAST_VTI_TABLE ?? "vtis" });
  }
  return new JsonlVtiStore(storePath);
}

// A public "sample tier" teaser for a stored record — metadata + the RED→GREEN
// receipt, never the trainable fixtures. Mirrors the catalog's open sample tier.
export function toTeaser(v: StoredVti): Record<string, unknown> {
  return {
    trapId: v.trapId,
    title: v.title ?? null,
    sdk: v.sdk ?? null,
    class: v.class ?? null,
    severity: v.severity ?? null,
    redGreenProof: v.redGreenProof ?? null,
    provenance: v.provenance ?? null,
    corroborationCount: v.corroborationCount ?? null,
    capturedAt: v.capturedAt ?? null,
  };
}
