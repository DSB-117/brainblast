import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BATCH_MAX_EVENTS,
  MemoryHiveStore,
  isSpaceId,
  makeBatch,
  newSpaceId,
  signBody,
  verifyBatch,
  verifyBody,
} from "../src/hive/federation.ts";
import { identityPath, loadIdentity, loadOrCreateIdentity } from "../src/hive/identity.ts";
import {
  JsonlHiveStore,
  createSpace,
  joinSpace,
  leaveSpace,
  loadSpaces,
  mergeSharedEvents,
  syncAllSpaces,
  syncSpace,
} from "../src/hive/spaces.ts";
import { loadExperience, loadLocalExperience, loadSharedExperience, recordFixEvents } from "../src/hive/experience.ts";
import { handleRequest, type ServerDeps } from "../src/server.ts";
import type { ExperienceEvent } from "../src/hive/experience.ts";

function event(over: Partial<ExperienceEvent> = {}): ExperienceEvent {
  return {
    ruleId: "stripe-webhook-raw-body",
    repoPath: "/work/app-a",
    repoName: "app-a",
    file: "src/webhook.ts",
    exportName: "handleWebhook",
    fixedAt: "2026-07-01",
    detail: "raw body was not used",
    ...over,
  };
}

describe("hive identity", () => {
  let root: string;
  beforeEach(() => (root = mkdtempSync(join(tmpdir(), "hive-fed-"))));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates once, persists, and stays stable across loads", () => {
    expect(loadIdentity(root)).toBeNull();
    const a = loadOrCreateIdentity(root, "2026-07-08T00:00:00.000Z");
    const b = loadOrCreateIdentity(root);
    expect(b.address).toBe(a.address);
    expect(a.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(existsSync(identityPath(root))).toBe(true);
  });

  it("sign/verify round-trips and rejects a wrong key or tampered body", () => {
    const id = loadOrCreateIdentity(root);
    const other = loadOrCreateIdentity(mkdtempSync(join(tmpdir(), "hive-fed2-")));
    const body = { hello: "swarm", n: 1 };
    const sig = signBody(id.secretKey, body);
    expect(verifyBody(id.address, body, sig)).toBe(true);
    expect(verifyBody(other.address, body, sig)).toBe(false);
    expect(verifyBody(id.address, { hello: "swarm", n: 2 }, sig)).toBe(false);
  });
});

describe("federation protocol — spaces + signed batches", () => {
  const root = mkdtempSync(join(tmpdir(), "hive-proto-"));
  const id = loadOrCreateIdentity(root);

  it("space ids are prefixed, high-entropy, and validated", () => {
    const s = newSpaceId();
    expect(isSpaceId(s)).toBe(true);
    expect(newSpaceId()).not.toBe(s);
    expect(isSpaceId("hs_short")).toBe(false);
    expect(isSpaceId("not-a-space")).toBe(false);
  });

  it("a signed batch verifies; tampering with any field breaks it", () => {
    const space = newSpaceId();
    const batch = makeBatch(id.secretKey, id.address, space, [event()], "2026-07-08T00:00:00.000Z");
    expect(verifyBatch(batch)).toMatchObject({ valid: true });

    expect(verifyBatch({ ...batch, space: newSpaceId() }).reason).toBe("bad-signature"); // replay into another space
    expect(verifyBatch({ ...batch, author: loadOrCreateIdentity(mkdtempSync(join(tmpdir(), "x-"))).address }).reason).toBe("bad-signature");
    expect(verifyBatch({ ...batch, events: [event({ detail: "poisoned" })] }).reason).toBe("bad-signature");
  });

  it("rejects malformed, oversized, and empty batches before any crypto", () => {
    const space = newSpaceId();
    expect(verifyBatch({} as any).reason).toBe("malformed");
    expect(verifyBatch(makeBatch(id.secretKey, id.address, "hs_bogus!", [event()])).reason).toBe("bad-space");
    const tooMany = Array.from({ length: BATCH_MAX_EVENTS + 1 }, () => event());
    expect(verifyBatch(makeBatch(id.secretKey, id.address, space, tooMany)).reason).toBe("too-many-events");
    const oversized = [event({ detail: "x".repeat(3000) })];
    expect(verifyBatch(makeBatch(id.secretKey, id.address, space, oversized)).reason).toBe("oversized-event");
    expect(verifyBatch(makeBatch(id.secretKey, id.address, space, [])).reason).toBe("malformed");
  });
});

describe("federation stores — Memory (spec) and Jsonl (serve) agree", () => {
  for (const [label, make] of [
    ["memory", () => new MemoryHiveStore()],
    ["jsonl", () => new JsonlHiveStore(join(mkdtempSync(join(tmpdir(), "hive-store-")), "x.jsonl"))],
  ] as const) {
    it(`${label}: append is idempotent per author, seq is monotonic, list resumes from a cursor`, async () => {
      const store = make();
      const space = newSpaceId();
      const r1 = await store.append(space, "authorA", [event(), event({ ruleId: "other" })]);
      expect(r1).toMatchObject({ accepted: 2, duplicates: 0, total: 2 });
      // Same events, same author → duplicates. Same events, DIFFERENT author → new.
      expect(await store.append(space, "authorA", [event()])).toMatchObject({ accepted: 0, duplicates: 1 });
      expect((await store.append(space, "authorB", [event()])).accepted).toBe(1);

      const all = await store.list(space);
      expect(all.events.map((e) => e.seq)).toEqual([1, 2, 3]);
      const delta = await store.list(space, all.events[1].seq);
      expect(delta.events.map((e) => e.author)).toEqual(["authorB"]);
      expect(delta.cursor).toBe(3);
      // Another space is fully isolated.
      expect((await store.list(newSpaceId())).events).toEqual([]);
    });
  }
});

describe("federation end-to-end through the pure server handler", () => {
  let rootA: string; // machine A
  let rootB: string; // machine B
  let store: MemoryHiveStore;
  beforeEach(() => {
    rootA = mkdtempSync(join(tmpdir(), "hive-a-"));
    rootB = mkdtempSync(join(tmpdir(), "hive-b-"));
    store = new MemoryHiveStore();
  });
  afterEach(() => {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  // A fetchImpl that routes straight into handleRequest — the same code path
  // brainblast serve and the registry run.
  function fetchVia(deps: ServerDeps) {
    return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const u = new URL(url);
      const query: Record<string, string> = {};
      for (const [k, v] of u.searchParams) query[k] = v;
      const resp = await handleRequest(
        {
          method: init?.method ?? "GET",
          path: u.pathname,
          query,
          space: init?.headers?.["x-brainblast-space"],
          body: init?.body,
        },
        deps,
      );
      return { status: resp.status, text: async () => resp.body };
    };
  }

  it("machine A's fix reaches machine B; self-events never round-trip; cursors advance", async () => {
    const deps: ServerDeps = { lots: [], hiveStore: store };
    const fetchImpl = fetchVia(deps);

    // Machine A records a local fix and creates the space.
    recordFixEvents(rootA, { path: "/work/app-a", name: "app-a" }, [
      { ruleId: "stripe-webhook-raw-body", file: "src/webhook.ts", exportName: "handleWebhook", fixedAt: "2026-07-01", detail: "raw body" },
    ]);
    const space = createSpace(rootA, { name: "team", remote: "https://srv.test" });

    const a1 = await syncSpace(rootA, space, loadLocalExperience(rootA), fetchImpl);
    expect(a1).toMatchObject({ pushed: 1, pulled: 0 });

    // Machine B joins with the shared id and syncs.
    const joined = joinSpace(rootB, space.id, { remote: "https://srv.test" });
    const b1 = await syncSpace(rootB, joined, loadLocalExperience(rootB), fetchImpl);
    expect(b1).toMatchObject({ pushed: 0, pulled: 1 });

    // B now KNOWS A's fix — attributed to A's identity — and precedents see it.
    const sharedOnB = loadSharedExperience(rootB);
    expect(sharedOnB).toHaveLength(1);
    expect(sharedOnB[0].author).toBe(loadOrCreateIdentity(rootA).address);
    expect(loadExperience(rootB).some((e) => e.ruleId === "stripe-webhook-raw-body")).toBe(true);

    // A re-syncs: its own event comes back but is filtered (no self round-trip),
    // and the push dedups server-side.
    const a2 = await syncSpace(rootA, loadSpaces(rootA).spaces[0], loadLocalExperience(rootA), fetchImpl);
    expect(a2).toMatchObject({ pushed: 0, pushDuplicates: 1, pulled: 0 });
    expect(loadSharedExperience(rootA)).toHaveLength(0);

    // B fixes something too; it flows back to A on the next round.
    recordFixEvents(rootB, { path: "/work/app-b", name: "app-b" }, [
      { ruleId: "jwt-alg-none", file: "auth.ts", exportName: "issue", fixedAt: "2026-07-02", detail: "alg none" },
    ]);
    await syncSpace(rootB, loadSpaces(rootB).spaces[0], loadLocalExperience(rootB), fetchImpl);
    const a3 = await syncSpace(rootA, loadSpaces(rootA).spaces[0], loadLocalExperience(rootA), fetchImpl);
    expect(a3.pulled).toBe(1);
    expect(loadSharedExperience(rootA)[0].ruleId).toBe("jwt-alg-none");
  });

  it("the server rejects: missing space header, forged signature, space mismatch, wrong method", async () => {
    const deps: ServerDeps = { lots: [], hiveStore: store };
    const id = loadOrCreateIdentity(rootA);
    const space = newSpaceId();
    const batch = makeBatch(id.secretKey, id.address, space, [event()]);

    const noHeader = await handleRequest({ method: "POST", path: "/hive/experience", query: {}, body: JSON.stringify(batch) }, deps);
    expect(noHeader.status).toBe(400);

    const forged = { ...batch, events: [event({ detail: "poison" })] };
    const bad = await handleRequest(
      { method: "POST", path: "/hive/experience", query: {}, space, body: JSON.stringify(forged) },
      deps,
    );
    expect(bad.status).toBe(403);
    expect(JSON.parse(bad.body).reason).toBe("bad-signature");

    const otherSpace = newSpaceId();
    const mismatch = await handleRequest(
      { method: "POST", path: "/hive/experience", query: {}, space: otherSpace, body: JSON.stringify(batch) },
      deps,
    );
    expect(mismatch.status).toBe(403);
    expect(JSON.parse(mismatch.body).reason).toBe("space-mismatch");

    const put = await handleRequest({ method: "PUT", path: "/hive/experience", query: {}, space }, deps);
    expect(put.status).toBe(405);

    const notEnabled = await handleRequest({ method: "GET", path: "/hive/experience", query: {}, space }, { lots: [] });
    expect(notEnabled.status).toBe(404);
  });

  it("space membership fs lifecycle: create/join/list/leave; per-space failures isolate in syncAllSpaces", async () => {
    const s1 = createSpace(rootA, { name: "solo", remote: "https://good.test" });
    joinSpace(rootA, newSpaceId(), { name: "dead", remote: "https://dead.test" });
    expect(loadSpaces(rootA).spaces).toHaveLength(2);
    expect(() => joinSpace(rootA, "nonsense")).toThrow(/not a valid space id/);

    const deps: ServerDeps = { lots: [], hiveStore: store };
    const good = fetchVia(deps);
    const fetchImpl = async (url: string, init?: any) =>
      url.startsWith("https://dead.test") ? { status: 500, text: async () => "down" } : good(url, init);

    recordFixEvents(rootA, { path: "/w/r", name: "r" }, [
      { ruleId: "x", file: "a.ts", exportName: "f", fixedAt: "2026-07-01", detail: "d" },
    ]);
    const reports = await syncAllSpaces(rootA, loadLocalExperience(rootA), fetchImpl as any);
    expect(reports).toHaveLength(2);
    expect(reports.find((r) => r.name === "solo")).toMatchObject({ pushed: 1 });
    expect(reports.find((r) => r.name === "dead")!.error).toContain("500");

    expect(leaveSpace(rootA, s1.id)).toBe(true);
    expect(leaveSpace(rootA, s1.id)).toBe(false);
    expect(loadSpaces(rootA).spaces).toHaveLength(1);
  });

  it("mergeSharedEvents dedups by author+key and skips self", () => {
    const self = loadOrCreateIdentity(rootA).address;
    const stored = { ...event(), author: "someoneElse", seq: 1 };
    expect(mergeSharedEvents(rootA, [stored], self)).toBe(1);
    expect(mergeSharedEvents(rootA, [stored], self)).toBe(0);
    expect(mergeSharedEvents(rootA, [{ ...event(), author: self, seq: 2 }], self)).toBe(0);
    expect(loadSharedExperience(rootA)).toHaveLength(1);
  });
});

describe("SupabaseHiveStore — PostgREST wire contract (mocked)", () => {
  it("append upserts with ignore-duplicates on the unique key and reports totals", async () => {
    const calls: { url: string; init?: any }[] = [];
    const fetchImpl = (async (url: string, init?: any) => {
      calls.push({ url, init });
      if (init?.method === "POST") {
        return { ok: true, status: 201, json: async () => [{ seq: 1 }], text: async () => "", headers: new Map() as any };
      }
      // HEAD count request
      return {
        ok: true,
        status: 200,
        json: async () => [],
        text: async () => "",
        headers: { get: (k: string) => (k === "content-range" ? "0-0/3" : null) },
      };
    }) as unknown as typeof fetch;

    const { SupabaseHiveStore } = await import("../src/hive/federation.ts");
    const store = new SupabaseHiveStore("https://sb.test", "service-key", fetchImpl);
    const space = newSpaceId();
    const r = await store.append(space, "authorA", [event(), event({ ruleId: "dup" })]);
    expect(r).toMatchObject({ accepted: 1, duplicates: 1, total: 3 });

    const post = calls[0];
    expect(post.url).toContain("/rest/v1/hive_experience?on_conflict=space,author,event_key");
    expect(post.init.headers.prefer).toContain("ignore-duplicates");
    expect(post.init.headers.authorization).toBe("Bearer service-key");
    const rows = JSON.parse(post.init.body);
    expect(rows[0]).toMatchObject({ space, author: "authorA" });
    expect(rows[0].event_key).toContain("stripe-webhook-raw-body");
  });

  it("list pulls the space's delta ordered by seq and maps rows to attributed events", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toContain("seq=gt.5");
      expect(url).toContain("order=seq.asc");
      return {
        ok: true,
        status: 200,
        json: async () => [{ seq: 6, author: "authorB", event: event({ ruleId: "pulled" }) }],
        text: async () => "",
      };
    }) as unknown as typeof fetch;

    const { SupabaseHiveStore } = await import("../src/hive/federation.ts");
    const store = new SupabaseHiveStore("https://sb.test", "service-key", fetchImpl);
    const r = await store.list(newSpaceId(), 5);
    expect(r.cursor).toBe(6);
    expect(r.events[0]).toMatchObject({ ruleId: "pulled", author: "authorB", seq: 6 });
  });

  it("surfaces backend failures loudly", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) })) as unknown as typeof fetch;
    const { SupabaseHiveStore } = await import("../src/hive/federation.ts");
    const store = new SupabaseHiveStore("https://sb.test", "k", fetchImpl);
    await expect(store.append(newSpaceId(), "a", [event()])).rejects.toThrow(/append failed/);
    await expect(store.list(newSpaceId())).rejects.toThrow(/list failed/);
  });
});
