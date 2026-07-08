import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncFeed, syncPacks, gitBlobSha1, DEFAULT_HIVE_REMOTE } from "../src/hive/sync.ts";
import { hivePaths, loadCursor, loadHiveLot, saveCursor } from "../src/hive/store.ts";

type MockRoute = { status?: number; body: string };

function mockFetch(routes: Record<string, MockRoute>, calls: { url: string; headers?: Record<string, string> }[] = []) {
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    const route = routes[url];
    if (!route) return { status: 404, text: async () => `no mock for ${url}` };
    return { status: route.status ?? 200, text: async () => route.body };
  };
  return { impl, calls };
}

function ndjson(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function vtiLine(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "vti",
    trapId: "stripe-webhook-raw-body",
    sdk: { name: "stripe", version: "17.0.0" },
    severity: "critical",
    class: "auth-bypass",
    score: 100,
    corroborationCount: 1,
    license: "synthetic-owned",
    capturedAt: "2026-06-01T00:00:00.000Z",
    sourceUrls: ["https://docs.stripe.com/webhooks"],
    receipt: { red: true, green: true, method: "static-checker" },
    ...over,
  };
}

describe("hive feed sync", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-sync-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("pulls the delta anonymously, ingests records, and saves the cursor + tier", async () => {
    const { impl, calls } = mockFetch({
      "https://reg.test/api/feed": {
        body: ndjson([
          { type: "feed_meta", tier: "sample", access: "anonymous" },
          vtiLine(),
          vtiLine({ trapId: "jwt-alg-none", sdk: { name: "jsonwebtoken", version: null }, capturedAt: "2026-06-03T00:00:00.000Z" }),
          { type: "feed_complete", cursor: "2026-06-03T00:00:00.000Z", counts: { emitted: 2 } },
        ]),
      },
    });

    const report = await syncFeed({ root, remote: "https://reg.test/api", fetchImpl: impl, now: "2026-06-04T00:00:00.000Z" });
    expect(report).toMatchObject({ tier: "sample", granted: false, fetched: 2, added: 2, total: 2 });
    expect(calls[0].headers?.["x-brainblast-grant"]).toBeUndefined();

    const cursor = loadCursor(root);
    expect(cursor.cursor).toBe("2026-06-03T00:00:00.000Z");
    expect(cursor.tier).toBe("sample");
    expect(cursor.remote).toBe("https://reg.test/api");
    expect(loadHiveLot(root)[0].redGreenProof).toMatchObject({ red: true, green: true });
  });

  it("resumes from the stored cursor and remote, and never regresses the cursor", async () => {
    saveCursor(root, {
      schemaVersion: "1.0",
      cursor: "2026-06-03T00:00:00.000Z",
      lastSyncAt: "2026-06-03T01:00:00.000Z",
      remote: "https://reg.test/api",
      tier: "sample",
      packsSha: null,
      packsSyncedAt: null,
    });
    const { impl, calls } = mockFetch({
      "https://reg.test/api/feed?since=2026-06-03T00%3A00%3A00.000Z": {
        body: ndjson([
          { type: "feed_meta", tier: "sample", access: "anonymous" },
          { type: "feed_complete", cursor: "2026-06-03T00:00:00.000Z", counts: { emitted: 0 } },
        ]),
      },
    });

    const report = await syncFeed({ root, fetchImpl: impl });
    expect(calls[0].url).toContain("since=");
    expect(report.fetched).toBe(0);
    expect(loadCursor(root).cursor).toBe("2026-06-03T00:00:00.000Z");
  });

  it("presents the hive grant as a header and enriched records land", async () => {
    writeFileSync(hivePaths(root).grantFile, JSON.stringify({ buyer: "me", tier: "standard" }));
    const { impl, calls } = mockFetch({
      "https://reg.test/api/feed": {
        body: ndjson([
          { type: "feed_meta", tier: "standard", access: "granted" },
          vtiLine({ fixtures: { vulnerable: { snippet: "VULN" }, fixed: { snippet: "FIXED" } } }),
          { type: "feed_complete", cursor: "2026-06-01T00:00:00.000Z", counts: { emitted: 1 } },
        ]),
      },
    });

    const report = await syncFeed({ root, remote: "https://reg.test/api", fetchImpl: impl });
    expect(report).toMatchObject({ tier: "standard", granted: true, added: 1 });
    const header = calls[0].headers?.["x-brainblast-grant"];
    expect(header).toBeDefined();
    expect(JSON.parse(Buffer.from(header!, "base64").toString("utf8"))).toMatchObject({ buyer: "me" });
    expect((loadHiveLot(root)[0] as any).vulnerable.snippet).toBe("VULN");
  });

  it("fail-closed: a truncated response (no feed_complete) ingests nothing and keeps the cursor", async () => {
    const { impl } = mockFetch({
      "https://reg.test/api/feed": {
        body: ndjson([{ type: "feed_meta", tier: "sample" }, vtiLine()]),
      },
    });
    await expect(syncFeed({ root, remote: "https://reg.test/api", fetchImpl: impl })).rejects.toThrow(/feed_complete/);
    expect(loadHiveLot(root)).toHaveLength(0);
    expect(loadCursor(root).cursor).toBeNull();
  });

  it("a non-200 response throws with the server detail", async () => {
    const { impl } = mockFetch({
      "https://reg.test/api/feed": { status: 500, body: "boom" },
    });
    await expect(syncFeed({ root, remote: "https://reg.test/api", fetchImpl: impl })).rejects.toThrow(/500/);
  });

  it("--fresh ignores the stored cursor", async () => {
    saveCursor(root, {
      schemaVersion: "1.0",
      cursor: "2026-06-03T00:00:00.000Z",
      lastSyncAt: null,
      remote: "https://reg.test/api",
      tier: null,
      packsSha: null,
      packsSyncedAt: null,
    });
    const { impl, calls } = mockFetch({
      "https://reg.test/api/feed": {
        body: ndjson([
          { type: "feed_meta", tier: "sample" },
          { type: "feed_complete", cursor: null, counts: { emitted: 0 } },
        ]),
      },
    });
    await syncFeed({ root, fetchImpl: impl, fresh: true });
    expect(calls[0].url).not.toContain("since=");
    // A fresh pull that returned nothing must not erase the cursor we had.
    expect(loadCursor(root).cursor).toBe("2026-06-03T00:00:00.000Z");
  });

  it("defaults the remote to the hosted registry API", () => {
    expect(DEFAULT_HIVE_REMOTE).toMatch(/^https:\/\/registry\./);
  });
});

describe("hive pack sync", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-packs-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const SHA = "a".repeat(40);
  const manifest = "id: demo-pack\nname: Demo\nversion: 1.0.0\nauthor: brainblast\n";
  const ruleYaml = "id: demo-rule\n";

  function packRoutes(): Record<string, MockRoute> {
    return {
      "https://api.github.com/repos/o/r/commits/main": { body: JSON.stringify({ sha: SHA }) },
      [`https://api.github.com/repos/o/r/git/trees/${SHA}?recursive=1`]: {
        body: JSON.stringify({
          truncated: false,
          tree: [
            { type: "blob", path: "packs/demo-pack/brainblast-pack.yaml", sha: gitBlobSha1(manifest) },
            { type: "blob", path: "packs/demo-pack/rules/demo-rule.yaml", sha: gitBlobSha1(ruleYaml) },
            { type: "blob", path: "packs/demo-pack/fixtures/x/vulnerable/a.ts", sha: "ignored" }, // not mirrored
            { type: "blob", path: "README.md", sha: "ignored" },
          ],
        }),
      },
      [`https://raw.githubusercontent.com/o/r/${SHA}/packs/demo-pack/brainblast-pack.yaml`]: { body: manifest },
      [`https://raw.githubusercontent.com/o/r/${SHA}/packs/demo-pack/rules/demo-rule.yaml`]: { body: ruleYaml },
    };
  }

  it("mirrors manifests + rules at a pinned sha, blob-verified, and records provenance", async () => {
    const { impl } = mockFetch(packRoutes());
    const report = await syncPacks({ root, repo: "o/r", fetchImpl: impl, now: "2026-06-04T00:00:00.000Z" });
    expect(report).toMatchObject({ sha: SHA, skipped: false, packs: 1, filesFetched: 2 });

    const paths = hivePaths(root);
    expect(readFileSync(join(paths.packsDir, "demo-pack", "brainblast-pack.yaml"), "utf8")).toBe(manifest);
    expect(existsSync(join(paths.packsDir, "demo-pack", "fixtures"))).toBe(false);
    expect(loadCursor(root)).toMatchObject({ packsSha: SHA, packsSyncedAt: "2026-06-04T00:00:00.000Z" });
  });

  it("skips when the resolved sha is unchanged (and re-mirrors with force)", async () => {
    const { impl, calls } = mockFetch(packRoutes());
    await syncPacks({ root, repo: "o/r", fetchImpl: impl });
    const callsBefore = calls.length;

    const again = await syncPacks({ root, repo: "o/r", fetchImpl: impl });
    expect(again.skipped).toBe(true);
    expect(calls.length).toBe(callsBefore + 1); // only the commit resolution

    const forced = await syncPacks({ root, repo: "o/r", fetchImpl: impl, force: true });
    expect(forced.skipped).toBe(false);
  });

  it("removes local packs that no longer exist upstream", async () => {
    const paths = hivePaths(root);
    mkdirSync(join(paths.packsDir, "withdrawn-pack"), { recursive: true });
    writeFileSync(join(paths.packsDir, "withdrawn-pack", "brainblast-pack.yaml"), "id: withdrawn-pack\n");

    const { impl } = mockFetch(packRoutes());
    const report = await syncPacks({ root, repo: "o/r", fetchImpl: impl });
    expect(report.removedPacks).toEqual(["withdrawn-pack"]);
    expect(existsSync(join(paths.packsDir, "withdrawn-pack"))).toBe(false);
  });

  it("aborts on a blob hash mismatch (tampered or truncated transfer)", async () => {
    const routes = packRoutes();
    routes[`https://raw.githubusercontent.com/o/r/${SHA}/packs/demo-pack/rules/demo-rule.yaml`] = { body: "id: tampered\n" };
    const { impl } = mockFetch(routes);
    await expect(syncPacks({ root, repo: "o/r", fetchImpl: impl })).rejects.toThrow(/hash mismatch/);
  });

  it("refuses to empty the mirror when upstream lists no packs", async () => {
    const { impl } = mockFetch({
      "https://api.github.com/repos/o/r/commits/main": { body: JSON.stringify({ sha: SHA }) },
      [`https://api.github.com/repos/o/r/git/trees/${SHA}?recursive=1`]: {
        body: JSON.stringify({ truncated: false, tree: [{ type: "blob", path: "README.md", sha: "x" }] }),
      },
    });
    await expect(syncPacks({ root, repo: "o/r", fetchImpl: impl })).rejects.toThrow(/refusing to empty/);
  });

  it("gitBlobSha1 matches git's own object hash", () => {
    // `echo -n 'hello' | git hash-object --stdin` → b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
    expect(gitBlobSha1("hello")).toBe("b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
  });
});
