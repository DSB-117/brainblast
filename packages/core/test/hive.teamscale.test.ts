import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryHiveStore,
  makePolicy,
  newSpaceId,
  policyAllowsRead,
  policyAllowsWrite,
  verifyPolicy,
  type SpacePolicy,
} from "../src/hive/federation.ts";
import { loadOrCreateIdentity } from "../src/hive/identity.ts";
import {
  createSpace,
  fetchSpacePolicy,
  joinSpace,
  syncSpace,
  updateSpacePolicy,
} from "../src/hive/spaces.ts";
import { loadLocalExperience, loadSharedExperience, recordFixEvents } from "../src/hive/experience.ts";
import { buildDashboard, renderDashboardHtml, renderDashboardText } from "../src/hive/dashboard.ts";
import { handleRequest, type ServerDeps } from "../src/server.ts";
import type { ExperienceEvent } from "../src/hive/experience.ts";

function ev(over: Partial<ExperienceEvent> = {}): ExperienceEvent {
  return { ruleId: "x-algorithm-none", repoPath: "/w/a", repoName: "a", file: "f.ts", exportName: "fn", fixedAt: "2026-07-09", detail: "d", ...over };
}

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
        reader: init?.headers?.["x-brainblast-reader"],
        body: init?.body,
      },
      deps,
    );
    return { status: resp.status, text: async () => resp.body };
  };
}

describe("ACL — signed space policies", () => {
  const rootA = mkdtempSync(join(tmpdir(), "acl-a-"));
  const rootB = mkdtempSync(join(tmpdir(), "acl-b-"));
  const admin = loadOrCreateIdentity(rootA);
  const outsider = loadOrCreateIdentity(rootB);
  const space = newSpaceId();

  it("verifyPolicy: TOFU first, then admin-signed monotonic updates only", () => {
    const p1 = makePolicy(admin.secretKey, admin.address, {
      policyVersion: "1.0", space, version: 1, admins: [admin.address],
      writeMode: "allowlist", readMode: "capability", allowedWriters: [], allowedReaders: [], updatedAt: "t",
    });
    expect(verifyPolicy(p1, null)).toMatchObject({ valid: true });

    // outsider can't change an existing policy
    const bad = makePolicy(outsider.secretKey, outsider.address, {
      policyVersion: "1.0", space, version: 2, admins: [outsider.address],
      writeMode: "open", readMode: "capability", allowedWriters: [], allowedReaders: [], updatedAt: "t",
    });
    expect(verifyPolicy(bad, p1).reason).toBe("not-admin");

    // stale version rejected even from the admin
    const stale = makePolicy(admin.secretKey, admin.address, {
      policyVersion: "1.0", space, version: 1, admins: [admin.address],
      writeMode: "open", readMode: "capability", allowedWriters: [], allowedReaders: [], updatedAt: "t",
    });
    expect(verifyPolicy(stale, p1).reason).toBe("stale-version");

    // signer must list self as admin
    const notSelf = makePolicy(admin.secretKey, admin.address, {
      policyVersion: "1.0", space, version: 2, admins: [outsider.address],
      writeMode: "open", readMode: "capability", allowedWriters: [], allowedReaders: [], updatedAt: "t",
    });
    expect(verifyPolicy(notSelf, p1).reason).toBe("self-not-admin");

    // a forged signature fails
    expect(verifyPolicy({ ...p1, writeMode: "open" }, null).reason).toBe("bad-signature");
  });

  it("policyAllowsWrite/Read gates", () => {
    const p: SpacePolicy = makePolicy(admin.secretKey, admin.address, {
      policyVersion: "1.0", space, version: 1, admins: [admin.address],
      writeMode: "allowlist", readMode: "allowlist", allowedWriters: ["W1"], allowedReaders: ["R1"], updatedAt: "t",
    });
    expect(policyAllowsWrite(null, "anyone")).toBe(true); // no policy = open
    expect(policyAllowsWrite(p, admin.address)).toBe(true); // admin always
    expect(policyAllowsWrite(p, "W1")).toBe(true);
    expect(policyAllowsWrite(p, "nope")).toBe(false);
    expect(policyAllowsRead(p, "R1")).toBe(true);
    expect(policyAllowsRead(p, undefined)).toBe(false);
    expect(policyAllowsRead(p, "nope")).toBe(false);
  });
});

describe("ACL end-to-end through the handler + client", () => {
  let rootAdmin: string;
  let rootMember: string;
  let rootIntruder: string;
  let store: MemoryHiveStore;
  beforeEach(() => {
    rootAdmin = mkdtempSync(join(tmpdir(), "e-admin-"));
    rootMember = mkdtempSync(join(tmpdir(), "e-member-"));
    rootIntruder = mkdtempSync(join(tmpdir(), "e-intruder-"));
    store = new MemoryHiveStore();
  });
  afterEach(() => [rootAdmin, rootMember, rootIntruder].forEach((r) => rmSync(r, { recursive: true, force: true })));

  it("write-allowlist: admin restricts, an un-allowed id is refused, an allowed one gets in", async () => {
    const deps: ServerDeps = { lots: [], hiveStore: store };
    const fetchImpl = fetchVia(deps);

    const space = createSpace(rootAdmin, { name: "org", remote: "https://srv.test" });
    // Admin declares itself + sets write:allowlist (TOFU first policy).
    await updateSpacePolicy(rootAdmin, space, (d) => { d.writeMode = "allowlist"; }, fetchImpl);

    // Intruder joins by capability id and tries to contribute → refused.
    const intruderSpace = joinSpace(rootIntruder, space.id, { remote: "https://srv.test" });
    recordFixEvents(rootIntruder, { path: "/w/evil", name: "evil" }, [{ ruleId: "junk", file: "j.ts", exportName: "f", fixedAt: "2026-07-09", detail: "poison" }]);
    await expect(syncSpace(rootIntruder, intruderSpace, loadLocalExperience(rootIntruder), { fetchImpl })).rejects.toThrow(/not-allowed-to-write/);
    expect((await store.list(space.id)).events).toHaveLength(0);

    // Admin allowlists the member; member contributes fine.
    const memberAddr = loadOrCreateIdentity(rootMember).address;
    await updateSpacePolicy(rootAdmin, space, (d) => { d.allowedWriters.push(memberAddr); }, fetchImpl);
    const memberSpace = joinSpace(rootMember, space.id, { remote: "https://srv.test" });
    recordFixEvents(rootMember, { path: "/w/ok", name: "ok" }, [{ ruleId: "real", file: "r.ts", exportName: "f", fixedAt: "2026-07-09", detail: "fix" }]);
    const rep = await syncSpace(rootMember, memberSpace, loadLocalExperience(rootMember), { fetchImpl });
    expect(rep.pushed).toBe(1);
    expect((await store.list(space.id)).events).toHaveLength(1);
  });

  it("read-allowlist: an un-allowed reader is refused the pull", async () => {
    const deps: ServerDeps = { lots: [], hiveStore: store };
    const fetchImpl = fetchVia(deps);
    const space = createSpace(rootAdmin, { remote: "https://srv.test" });
    const stranger = loadOrCreateIdentity(rootIntruder).address;
    await updateSpacePolicy(rootAdmin, space, (d) => { d.readMode = "allowlist"; }, fetchImpl);

    const strangerSpace = joinSpace(rootIntruder, space.id, { remote: "https://srv.test" });
    await expect(syncSpace(rootIntruder, strangerSpace, [], { fetchImpl })).rejects.toThrow(/not-allowed-to-read|403/);

    // The admin (an allowed reader by virtue of being admin) can still read the SAME space.
    const adminRep = await syncSpace(rootAdmin, space, [], { fetchImpl });
    expect(adminRep.error).toBeUndefined();
    expect(await fetchSpacePolicy(space, fetchImpl)).toMatchObject({ readMode: "allowlist" });
  });
});

describe("push transport — long-poll", () => {
  it("wait returns immediately when events already exist; holds then returns when they arrive", async () => {
    const store = new MemoryHiveStore();
    const space = newSpaceId();
    await store.append(space, "A", [ev()]);
    // Already-present events: returns at once even with wait set.
    const immediate = await handleRequest(
      { method: "GET", path: "/hive/experience", query: { since: "0", wait: "5" }, space },
      { lots: [], hiveStore: store, pollMs: 20 },
    );
    expect(JSON.parse(immediate.body).events).toHaveLength(1);

    // Nothing new + a real (short) wait window: the loop polls and an event
    // appended mid-hold is delivered. Use tiny pollMs and real clock.
    const held = handleRequest(
      { method: "GET", path: "/hive/experience", query: { since: "1", wait: "3" }, space },
      { lots: [], hiveStore: store, pollMs: 20 },
    );
    setTimeout(() => void store.append(space, "B", [ev({ ruleId: "later" })]), 40);
    const res = await held;
    const events = JSON.parse(res.body).events;
    expect(events).toHaveLength(1);
    expect(events[0].author).toBe("B");
  });

  it("wait times out empty when nothing arrives", async () => {
    const store = new MemoryHiveStore();
    const res = await handleRequest(
      { method: "GET", path: "/hive/experience", query: { since: "0", wait: "1" }, space: newSpaceId() },
      { lots: [], hiveStore: store, pollMs: 20 },
    );
    expect(JSON.parse(res.body).events).toEqual([]);
  });
});

describe("team dashboard", () => {
  let root: string;
  beforeEach(() => (root = mkdtempSync(join(tmpdir(), "dash-"))));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("aggregates by pattern/repo/contributor and collapses per-repo instances", () => {
    const events: ExperienceEvent[] = [
      ev({ ruleId: "parabol-algorithm-none", repoName: "app-a", author: "A", fixedAt: "2026-07-08" }),
      ev({ ruleId: "gravitee-algorithm-none", repoName: "app-b", author: "B", fixedAt: "2026-07-09" }),
      ev({ ruleId: "fallow-algorithm-none", repoName: "app-a", author: "A", fixedAt: "2026-07-09" }),
      ev({ ruleId: "x-cookie-secure-false", repoName: "app-c", author: "B", fixedAt: "2026-07-09" }),
    ];
    const d = buildDashboard(events);
    expect(d.totalEvents).toBe(4);
    expect(d.contributors).toBe(2);
    expect(d.repos).toBe(3);
    // algorithm-none collapses across 3 source repos → count 3, ranked first.
    expect(d.byRule[0]).toMatchObject({ key: "algorithm-none", count: 3 });
    expect(d.byContributor.find((c) => c.key === "A")!.count).toBe(2);
    expect(d.byDay.map((x) => x.key)).toEqual(["2026-07-08", "2026-07-09"]);
    expect(d.firstAt).toBe("2026-07-08");

    const text = renderDashboardText(d);
    expect(text).toContain("algorithm-none");
    expect(text).toContain("2 contributors");
    const html = renderDashboardHtml(d);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("algorithm-none");
    expect(html).not.toContain("<script"); // self-contained, no active content
  });

  it("empty dashboard renders the hint", () => {
    const d = buildDashboard([]);
    expect(d.totalEvents).toBe(0);
    expect(renderDashboardText(d)).toContain("no shared experience yet");
  });
});

describe("JsonlHiveStore policy persistence (serve parity)", () => {
  it("round-trips a policy on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jsonl-pol-"));
    try {
      const { JsonlHiveStore } = await import("../src/hive/spaces.ts");
      const store = new JsonlHiveStore(join(dir, "exp.jsonl"));
      const space = newSpaceId();
      expect(store.getPolicy(space)).toBeNull();
      const id = loadOrCreateIdentity(dir);
      const p = makePolicy(id.secretKey, id.address, {
        policyVersion: "1.0", space, version: 1, admins: [id.address],
        writeMode: "allowlist", readMode: "capability", allowedWriters: [], allowedReaders: [], updatedAt: "t",
      });
      store.setPolicy(space, p);
      expect(store.getPolicy(space)).toMatchObject({ version: 1, writeMode: "allowlist" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
