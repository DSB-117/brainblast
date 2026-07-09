// The hosted distribution endpoint — R3 of ROADMAP-TRAINING-DATA.md.
//
// This is where "real entitlement is enforced at distribution" stops being a
// comment and becomes literally true: the SERVER holds the full lots, and a
// client with a grant receives only what its tier entitles. The local feed
// computed eligibility on lots you already possess; here the payload lives behind
// the endpoint, so the grant is the actual gate.
//
// Two honesty invariants from the roadmap's North Stars:
//   1. The catalog and the SAMPLE tier are public + anonymous — no grant needed
//      to browse or inspect (free-flowing access).
//   2. Paid tiers are unlocked by a SIGNED grant, verified here with only the
//      distributor's published ed25519 address (no shared secret) — the R2 win.
//
// This module is the PURE request handler (request → response), with ledger IO
// injected as a callback so it is fully unit-testable. The node:http binding +
// lot/ledger loading live in the CLI (`brainblast serve`).

import { buildCatalog, verifyGrant, type Grant, type GrantVerifier, type UsageRecord } from "./marketplace.ts";
import { selectFeed, type FeedQuery, type FeedTier } from "./feed.ts";
import type { CorpusVti } from "./corpus.ts";
import { TRAP_CLASSES, type TrapClass } from "./vtiClass.ts";
import {
  isSpaceId,
  policyAllowsRead,
  policyAllowsWrite,
  verifyBatch,
  verifyPolicy,
  type ExperienceBatch,
  type HiveExperienceStore,
  type SpacePolicy,
} from "./hive/federation.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A lot the server holds, kept named so a grant's lot-scope can be enforced.
export interface ServerLot {
  name: string; // basename, e.g. "seed-vti.jsonl"
  vtis: CorpusVti[];
}

export interface ServerDeps {
  lots: ServerLot[];
  trustedDistributor?: string; // ed25519 address the server trusts (R2)
  hmacSecret?: string; // legacy shared-secret verification
  now?: string; // injectable clock for deterministic tests
  // Called once on a successful GATED feed pull — the server's authoritative
  // metering. Throwing aborts the response with 500 (fail-closed accounting).
  meter?: (rec: UsageRecord) => void;
  // HiveMind federation (v0.11.0): when present, /hive/experience serves
  // signed cross-machine / team experience sync. Absent ⇒ 404 (opt-in).
  hiveStore?: HiveExperienceStore;
  // Push transport (v0.13.0) tuning + testability for the long-poll GET.
  pollMs?: number; // interval between store re-checks while holding (default 1000)
  abortLongPoll?: () => boolean; // let a binding cut a hold short (client disconnect / shutdown)
}

export interface ServerRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  grant?: Grant; // parsed by the binding from the grant header, if present
  space?: string; // x-brainblast-space header — the federation capability
  reader?: string; // x-brainblast-reader header — the reader's address (read-ACL spaces)
  body?: string; // raw request body (POST routes)
}

export interface ServerResponse {
  status: number;
  contentType: string;
  body: string;
}

function json(status: number, obj: unknown): ServerResponse {
  return { status, contentType: "application/json", body: JSON.stringify(obj, null, 2) };
}

function ndjson(lines: unknown[]): ServerResponse {
  return { status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" };
}

function allVtis(deps: ServerDeps): CorpusVti[] {
  return deps.lots.flatMap((l) => l.vtis);
}

function parseQuery(q: Record<string, string>): FeedQuery {
  const cls = q.class;
  return {
    sdk: q.sdk || undefined,
    class: cls && (TRAP_CLASSES as readonly string[]).includes(cls) ? (cls as TrapClass) : undefined,
    minSeverity: ["critical", "high", "medium", "low"].includes(q.severity) ? (q.severity as any) : undefined,
    minCorroboration: q.min_corroboration != null ? Number(q.min_corroboration) : undefined,
    since: q.since || undefined,
    limit: q.limit != null ? Number(q.limit) : undefined,
  };
}

// Build the verifier for a presented grant from the server's trust roots.
function verifierFor(grant: Grant, deps: ServerDeps): GrantVerifier | { error: string } {
  const alg = grant.alg ?? "hmac-sha256";
  if (alg === "ed25519") {
    if (!deps.trustedDistributor) return { error: "server has no trusted distributor key configured" };
    return { alg: "ed25519", publicKey: deps.trustedDistributor };
  }
  if (!deps.hmacSecret) return { error: "server has no hmac secret configured" };
  return { alg: "hmac-sha256", secret: deps.hmacSecret };
}

export async function handleRequest(req: ServerRequest, deps: ServerDeps): Promise<ServerResponse> {
  // HiveMind federation: signed experience sync for cross-machine and team
  // hives. The space id (an unguessable capability, sent as a header so it
  // stays out of URL logs) is the membership check; the ed25519 signature on
  // every pushed batch is the attribution check. Reads and writes both
  // require the space id; nothing here ever enters the RED→GREEN-gated
  // corpus — experience is advisory context.
  // Per-space access policy (ACL) — GET the current policy, POST a signed
  // update. TOFU bootstrap then admin-signed changes (see verifyPolicy).
  if (req.path === "/hive/policy") {
    if (!deps.hiveStore) return json(404, { error: "federation not enabled on this endpoint" });
    if (!isSpaceId(req.space)) return json(400, { error: "missing or malformed x-brainblast-space header" });
    if (!deps.hiveStore.getPolicy || !deps.hiveStore.setPolicy) return json(501, { error: "this endpoint does not support space policies" });

    if (req.method === "GET") {
      const policy = await deps.hiveStore.getPolicy(req.space!);
      return json(200, { policy });
    }
    if (req.method === "POST") {
      let candidate: SpacePolicy;
      try {
        candidate = JSON.parse(req.body ?? "");
      } catch {
        return json(400, { error: "malformed JSON body" });
      }
      if (candidate.space !== req.space) return json(403, { error: "policy rejected", reason: "space-mismatch" });
      const current = await deps.hiveStore.getPolicy(req.space!);
      const v = verifyPolicy(candidate, current);
      if (!v.valid) return json(403, { error: "policy rejected", reason: v.reason });
      await deps.hiveStore.setPolicy(req.space!, candidate);
      return json(200, { ok: true, version: candidate.version });
    }
    return json(405, { error: "method not allowed" });
  }

  if (req.path === "/hive/experience") {
    if (!deps.hiveStore) return json(404, { error: "federation not enabled on this endpoint" });
    if (!isSpaceId(req.space)) return json(400, { error: "missing or malformed x-brainblast-space header" });
    const policy = deps.hiveStore.getPolicy ? await deps.hiveStore.getPolicy(req.space!) : null;

    if (req.method === "POST") {
      let batch: ExperienceBatch;
      try {
        batch = JSON.parse(req.body ?? "");
      } catch {
        return json(400, { error: "malformed JSON body" });
      }
      const v = verifyBatch(batch);
      if (!v.valid) return json(403, { error: "batch rejected", reason: v.reason });
      // The transport capability and the signed payload must agree — a batch
      // signed for one space cannot be replayed into another.
      if (batch.space !== req.space) return json(403, { error: "batch rejected", reason: "space-mismatch" });
      // ACL: a restricted space only accepts events from allowlisted authors.
      if (!policyAllowsWrite(policy, batch.author)) return json(403, { error: "batch rejected", reason: "not-allowed-to-write" });
      const result = await deps.hiveStore.append(batch.space, batch.author, batch.events);
      return json(200, result);
    }

    if (req.method === "GET") {
      // ACL: a read-restricted space requires the reader to identify
      // themselves via x-brainblast-reader and be allowlisted.
      if (!policyAllowsRead(policy, req.reader)) return json(403, { error: "not entitled to read this space", reason: "not-allowed-to-read" });
      const since = req.query.since != null ? Number(req.query.since) : 0;
      const fromSeq = Number.isFinite(since) ? since : 0;

      // Push transport (long-poll): with ?wait=<seconds>, HOLD the request
      // until an event newer than `since` appears or the budget elapses —
      // turning ~60s polling latency into ~instant delivery, over plain HTTP,
      // serverless-safe (bounded). wait=0 (default) is an immediate return.
      const waitSec = req.query.wait != null ? Math.max(0, Math.min(30, Number(req.query.wait) || 0)) : 0;
      const deadline = Date.now() + waitSec * 1000;
      const pollMs = deps.pollMs ?? 1000;
      let result = await deps.hiveStore.list(req.space!, fromSeq);
      while (result.events.length === 0 && waitSec > 0 && Date.now() < deadline && !deps.abortLongPoll?.()) {
        await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
        result = await deps.hiveStore.list(req.space!, fromSeq);
      }
      return json(200, result);
    }

    return json(405, { error: "method not allowed" });
  }

  if (req.method !== "GET") return json(405, { error: "method not allowed" });

  if (req.path === "/healthz") {
    return json(200, { status: "ok", lots: deps.lots.length, vtis: allVtis(deps).length });
  }

  // Public + anonymous: the storefront. North Star #1 — no grant to browse.
  if (req.path === "/catalog") {
    return json(200, buildCatalog(allVtis(deps), { now: deps.now }));
  }

  if (req.path === "/feed") {
    const query = { ...parseQuery(req.query), now: deps.now } as FeedQuery;

    // Anonymous: serve the open SAMPLE tier (receipt-only, no fixtures). The
    // free-flowing on-ramp — no grant required.
    if (!req.grant) {
      const result = selectFeed(allVtis(deps), query, "sample");
      return ndjson([
        { type: "feed_meta", tier: "sample", entitlement: result.entitlement, access: "anonymous" },
        ...result.records.map((r) => ({ type: "vti", ...r })),
        { type: "feed_complete", cursor: result.cursor, counts: result.counts },
      ]);
    }

    // Gated: verify the grant against the server's trust root.
    const verifier = verifierFor(req.grant, deps);
    if ("error" in verifier) return json(500, { error: verifier.error });
    const v = verifyGrant(req.grant, verifier, deps.now);
    if (!v.valid) return json(403, { error: "grant rejected", reason: v.reason });

    const tier = req.grant.tier as FeedTier;
    // Lot-scope: a grant naming lots only entitles those.
    const scoped =
      Array.isArray(req.grant.lots) && req.grant.lots.length
        ? deps.lots.filter((l) => req.grant!.lots.includes(l.name))
        : deps.lots;
    const vtis = scoped.flatMap((l) => l.vtis);
    const result = selectFeed(vtis, query, tier);

    // Authoritative metering — the server records the pull. Fail-closed: if the
    // ledger write throws, the request 500s rather than serving unaccounted data.
    if (deps.meter) {
      try {
        deps.meter({
          ts: deps.now ?? new Date().toISOString(),
          buyer: v.buyer ?? req.grant.buyer,
          tier,
          lots: scoped.map((l) => l.name),
          recordsServed: result.records.length,
          cursor: result.cursor,
          query: { sdk: query.sdk, class: query.class, minSeverity: query.minSeverity },
        });
      } catch (e: any) {
        return json(500, { error: "metering failed", detail: e?.message ?? String(e) });
      }
    }

    return ndjson([
      { type: "feed_meta", tier, entitlement: result.entitlement, access: "granted", buyer: v.buyer },
      ...result.records.map((r) => ({ type: "vti", ...r })),
      { type: "feed_complete", cursor: result.cursor, counts: result.counts },
    ]);
  }

  return json(404, { error: "not found", path: req.path });
}
