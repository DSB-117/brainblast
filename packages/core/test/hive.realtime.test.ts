import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCargoDeps, extractGoDeps, extractPythonDeps, extractRepoDeps } from "../src/hive/repos.ts";
import {
  blockAuthor,
  createSpace,
  joinSpace,
  loadSpaces,
  mergeSharedEvents,
  rotateSpace,
  syncSpace,
  unblockAuthor,
} from "../src/hive/spaces.ts";
import { loadOrCreateIdentity } from "../src/hive/identity.ts";
import { loadSharedExperience, recordFixEvents, loadLocalExperience } from "../src/hive/experience.ts";
import { MemoryHiveStore } from "../src/hive/federation.ts";
import { refreshInjectedBriefs, startHiveWatch } from "../src/hive/watch.ts";
import { upsertVtis, hivePaths, saveCursor } from "../src/hive/store.ts";
import { linkRepo } from "../src/hive/repos.ts";
import { injectBlock, agentInstructionFile, HIVE_BLOCK_BEGIN } from "../src/hive/inject.ts";
import { handleRequest, type ServerDeps } from "../src/server.ts";
import type { CorpusVti } from "../src/corpus.ts";
import type { ExperienceEvent } from "../src/hive/experience.ts";

describe("multi-ecosystem dependency extraction", () => {
  let repo: string;
  beforeEach(() => (repo = mkdtempSync(join(tmpdir(), "hive-deps-"))));
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("Cargo.toml: simple, table, and dev deps — section-scoped", () => {
    writeFileSync(
      join(repo, "Cargo.toml"),
      `[package]
name = "my-program"
version = "0.1.0"

[dependencies]
anchor-lang = "0.30.1"
solana-program = { version = "1.18", features = ["no-entrypoint"] }

[dev-dependencies]
proptest = "1"

[features]
default = []
`,
    );
    const { name, deps } = extractCargoDeps(repo);
    expect(name).toBe("my-program");
    expect(deps).toEqual({ "anchor-lang": "0.30.1", "solana-program": "1.18", proptest: "1" });
  });

  it("go.mod: module name + block and single-line requires", () => {
    writeFileSync(
      join(repo, "go.mod"),
      `module github.com/acme/svc

go 1.22

require (
\tgithub.com/gagliardetto/solana-go v1.10.0
\tgithub.com/golang-jwt/jwt/v5 v5.2.1
)
require github.com/gorilla/sessions v1.2.2
`,
    );
    const { name, deps } = extractGoDeps(repo);
    expect(name).toBe("github.com/acme/svc");
    expect(deps["github.com/gagliardetto/solana-go"]).toBe("v1.10.0");
    expect(deps["github.com/golang-jwt/jwt/v5"]).toBe("v5.2.1");
    expect(deps["github.com/gorilla/sessions"]).toBe("v1.2.2");
  });

  it("Python: pyproject [project] deps, poetry deps, and requirements.txt (extras/markers stripped)", () => {
    writeFileSync(
      join(repo, "pyproject.toml"),
      `[project]
name = "my-api"
dependencies = [
  "stripe>=7.0",
  "PyJWT[crypto]==2.8.0",
]

[tool.poetry.dependencies]
python = "^3.11"
solders = "^0.21"
`,
    );
    writeFileSync(join(repo, "requirements.txt"), "requests==2.31.0\n# comment\n-r other.txt\nflask>=3 ; python_version>'3.10'\n");
    const { name, deps } = extractPythonDeps(repo);
    expect(name).toBe("my-api");
    expect(deps).toMatchObject({ stripe: ">=7.0", pyjwt: "==2.8.0", solders: "^0.21", requests: "==2.31.0", flask: ">=3" });
    expect(deps.python).toBeUndefined();
  });

  it("extractRepoDeps unions ecosystems, npm name winning", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "web", dependencies: { stripe: "^17" } }));
    writeFileSync(join(repo, "Cargo.toml"), '[package]\nname = "prog"\n[dependencies]\nanchor-lang = "0.30"\n');
    const { name, deps } = extractRepoDeps(repo);
    expect(name).toBe("web");
    expect(deps).toMatchObject({ stripe: "^17", "anchor-lang": "0.30" });
  });
});

describe("federation hardening — chunked push, rotate, block", () => {
  let root: string;
  let store: MemoryHiveStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-hard-"));
    store = new MemoryHiveStore();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function fetchVia(deps: ServerDeps) {
    return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const u = new URL(url);
      const query: Record<string, string> = {};
      for (const [k, v] of u.searchParams) query[k] = v;
      const resp = await handleRequest(
        { method: init?.method ?? "GET", path: u.pathname, query, space: init?.headers?.["x-brainblast-space"], body: init?.body },
        deps,
      );
      return { status: resp.status, text: async () => resp.body };
    };
  }

  it("a local log larger than one batch pushes fully (chunked)", async () => {
    const events = Array.from({ length: 750 }, (_, i) => ({
      ruleId: `rule-${i}`,
      file: `f${i}.ts`,
      exportName: "fn",
      fixedAt: "2026-07-01",
      detail: "d",
    }));
    recordFixEvents(root, { path: "/w/big", name: "big" }, events);
    const space = createSpace(root, { remote: "https://srv.test" });
    const report = await syncSpace(root, space, loadLocalExperience(root), fetchVia({ lots: [], hiveStore: store }));
    expect(report.pushed).toBe(750);
    expect((await store.list(space.id)).events).toHaveLength(750);
  });

  it("rotate leaves the old space and mints a replacement with the same name/remote", () => {
    const old = createSpace(root, { name: "team", remote: "https://srv.test" });
    const { next } = rotateSpace(root, old.id);
    const state = loadSpaces(root);
    expect(state.spaces.map((s) => s.id)).toEqual([next.id]);
    expect(next.id).not.toBe(old.id);
    expect(next.name).toBe("team");
    expect(next.remote).toBe("https://srv.test");
    expect(() => rotateSpace(root, old.id)).toThrow(/not a member/);
  });

  it("block drops future pulls from an author and purges existing events; unblock restores flow", () => {
    const self = loadOrCreateIdentity(root).address;
    const evil: ExperienceEvent & { author: string; seq: number } = {
      ruleId: "junk",
      repoPath: "/x",
      repoName: "x",
      file: "a.ts",
      exportName: "f",
      fixedAt: "2026-07-01",
      detail: "poison",
      author: "EvilAddress111",
      seq: 1,
    };
    expect(mergeSharedEvents(root, [evil], self)).toBe(1);
    const { purged } = blockAuthor(root, "EvilAddress111");
    expect(purged).toBe(1);
    expect(loadSharedExperience(root)).toHaveLength(0);
    expect(mergeSharedEvents(root, [{ ...evil, ruleId: "junk2" }], self)).toBe(0); // dropped on merge

    expect(unblockAuthor(root, "EvilAddress111")).toBe(true);
    expect(mergeSharedEvents(root, [{ ...evil, ruleId: "junk3" }], self)).toBe(1);
  });
});

describe("hive watch — the real-time loop", () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-watch-"));
    repo = mkdtempSync(join(tmpdir(), "hive-watch-repo-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const ndjson = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const vtiLine = (over: Record<string, unknown> = {}) => ({
    type: "vti",
    trapId: "stripe-webhook-raw-body",
    sdk: { name: "stripe", version: null },
    severity: "critical",
    class: "auth-bypass",
    score: 100,
    corroborationCount: 1,
    license: "synthetic-owned",
    capturedAt: "2026-07-09T00:00:00.000Z",
    sourceUrls: [],
    receipt: { red: true, green: true, method: "static-checker" },
    ...over,
  });

  it("a tick pulls new traps, alerts on outbreaks, and refreshes injected briefings", async () => {
    // Linked repo with an injected (stale/empty) briefing block.
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "shop", dependencies: { stripe: "^17.0.0" } }));
    linkRepo(root, repo);
    const file = agentInstructionFile(repo);
    injectBlock(file, "stale briefing");
    // Pin the packs cadence far in the future so the tick only exercises feed+federation.
    saveCursor(root, { schemaVersion: "1.0", cursor: null, lastSyncAt: null, remote: null, tier: null, packsSha: "x".repeat(40), packsSyncedAt: null });

    const logs: string[] = [];
    const fetchImpl = async (url: string) => {
      if (url.includes("/feed")) {
        return {
          status: 200,
          text: async () =>
            ndjson([
              { type: "feed_meta", tier: "sample" },
              vtiLine(),
              { type: "feed_complete", cursor: "2026-07-09T00:00:00.000Z", counts: { emitted: 1 } },
            ]),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const handle = startHiveWatch({
      root,
      remote: "https://reg.test/api",
      intervalMs: 3_600_000, // effectively "manual" — we drive ticks by hand
      packsIntervalMs: 3_600_000,
      log: (l) => logs.push(l),
      fetchImpl,
    });
    try {
      await handle.tick();
    } finally {
      handle.stop();
    }

    expect(logs.some((l) => l.includes("+1 new trap"))).toBe(true);
    expect(logs.some((l) => l.includes("OUTBREAK") && l.includes("shop"))).toBe(true);
    expect(logs.some((l) => l.includes("briefing refreshed in shop"))).toBe(true);
    const injected = readFileSync(file, "utf8");
    expect(injected).toContain("stripe-webhook-raw-body");
    expect(injected).not.toContain("stale briefing");
  });

  it("refreshInjectedBriefs never touches a repo without the marker, and survives unreadable repos", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "plain", dependencies: { stripe: "^17" } }));
    linkRepo(root, repo);
    upsertVtis(root, [
      {
        trapId: "stripe-webhook-raw-body",
        sdk: { name: "stripe" },
        severity: "critical",
        class: "auth-bypass",
        redGreenProof: { red: true, green: true },
        capturedAt: "2026-07-09T00:00:00.000Z",
      } as CorpusVti,
    ]);
    // No CLAUDE.md marker → nothing written.
    expect(refreshInjectedBriefs(root)).toBe(0);
    expect(readFileSync(join(repo, "package.json"), "utf8")).toContain("plain");

    // A linked repo whose path vanished must not throw.
    linkRepo(root, mkdtempSync(join(tmpdir(), "gone-")));
    expect(() => refreshInjectedBriefs(root)).not.toThrow();
  });

  it("watch keeps breathing through a failing feed (fail-open)", async () => {
    const logs: string[] = [];
    const handle = startHiveWatch({
      root,
      remote: "https://reg.test/api",
      intervalMs: 3_600_000,
      packsIntervalMs: 3_600_000,
      log: (l) => logs.push(l),
      fetchImpl: async () => ({ status: 500, text: async () => "down" }),
    });
    try {
      await handle.tick();
      await handle.tick();
    } finally {
      handle.stop();
    }
    expect(logs.filter((l) => l.includes("feed sync failed")).length).toBeGreaterThanOrEqual(1);
  });
});
