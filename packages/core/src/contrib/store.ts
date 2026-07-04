// The store seam — "the database" behind a direct VTI submission.
//
// `ingestSubmission` decides IF a record may land; the store decides WHERE it
// lands. Keeping them separate is the whole point: the off-repo registry swaps
// `JsonlVtiStore` for a Supabase-backed `VtiStore` and reuses the exact same
// validator, so a git-less write is safe by construction. Locally the JSONL file
// IS the database — it proves the endpoint end-to-end with no external service.
//
// Two invariants mirror the fleet ledger's server rules:
//   - idempotent  — inserting a trapId already present is a no-op, not an error
//     (a retried POST can't duplicate a record).
//   - non-destructive — an insert never rewrites or removes another record; the
//     store only ever appends.

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
  insert(vti: StoredVti): InsertResult;
  list(): StoredVti[];
  has(trapId: string): boolean;
}

// Append-only JSONL store. One record per line; the newest line for a trapId
// wins on read (append-only + idempotent insert means there's normally one).
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

  has(trapId: string): boolean {
    return this.read().some((r) => r.trapId === trapId);
  }

  list(): StoredVti[] {
    return this.read();
  }

  insert(vti: StoredVti): InsertResult {
    if (!vti || typeof vti.trapId !== "string" || vti.trapId.length === 0) {
      return { inserted: false, reason: "record has no trapId" };
    }
    if (this.has(vti.trapId)) {
      // Non-destructive + idempotent: keep the first landing, ignore the retry.
      return { inserted: false, reason: "trapId already present" };
    }
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(vti) + "\n", "utf8");
    return { inserted: true };
  }
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
    corroborationCount: v.corroborationCount ?? null,
    capturedAt: v.capturedAt ?? null,
  };
}
