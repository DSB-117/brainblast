import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  feedRecordToVti,
  hivePaths,
  hiveRoot,
  loadCursor,
  loadHiveLot,
  saveCursor,
  upsertVtis,
  vtiKey,
  HIVE_DIR_ENV,
} from "../src/hive/store.ts";
import { extractNpmDeps, linkRepo, unlinkRepo } from "../src/hive/repos.ts";
import { hiveStatus, renderHiveStatusText } from "../src/hive/status.ts";
import type { FeedRecord } from "../src/feed.ts";
import type { CorpusVti } from "../src/corpus.ts";

function record(over: Partial<FeedRecord> = {}): FeedRecord {
  return {
    trapId: "stripe-webhook-raw-body",
    title: "Stripe webhook must verify the raw body",
    sdk: { name: "stripe", version: "17.0.0" },
    severity: "critical",
    class: "auth-bypass",
    score: 100,
    corroborationCount: 2,
    license: "synthetic-owned",
    capturedAt: "2026-06-01T00:00:00.000Z",
    sourceUrls: ["https://docs.stripe.com/webhooks"],
    receipt: { red: true, green: true, method: "static-checker", verifiedAt: "2026-06-02T00:00:00.000Z" },
    ...over,
  };
}

function vti(over: Record<string, unknown> = {}): CorpusVti {
  return feedRecordToVti(record(over as Partial<FeedRecord>));
}

describe("hive store", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("hiveRoot honors the env override and defaults under the home dir", () => {
    expect(hiveRoot({ [HIVE_DIR_ENV]: "/custom/hive" } as any)).toBe("/custom/hive");
    expect(hiveRoot({} as any)).toContain(".brainblast");
  });

  it("feedRecordToVti maps receipt→redGreenProof and fixtures→vulnerable/fixed", () => {
    const bare = feedRecordToVti(record());
    expect(bare.redGreenProof).toMatchObject({ red: true, green: true, method: "static-checker" });
    expect((bare as any).vulnerable).toBeUndefined();
    expect(bare.sourceUrls).toEqual(["https://docs.stripe.com/webhooks"]);

    const rich = feedRecordToVti(
      record({
        fixtures: {
          vulnerable: { snippet: "VULN", lang: "typescript" },
          fixed: { snippet: "FIXED", lang: "typescript" },
          generatedTest: { kind: "vitest" },
        },
      }),
    );
    expect((rich as any).vulnerable.snippet).toBe("VULN");
    expect((rich as any).fixed.snippet).toBe("FIXED");
    expect((rich as any).generatedTest).toEqual({ kind: "vitest" });
  });

  it("upsertVtis appends new keys and reports duplicates unchanged", () => {
    const first = upsertVtis(root, [vti(), vti({ trapId: "jwt-alg-none" })]);
    expect(first).toMatchObject({ added: 2, updated: 0, unchanged: 0, total: 2 });

    const again = upsertVtis(root, [vti()]);
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 1, total: 2 });
    expect(loadHiveLot(root)).toHaveLength(2);
  });

  it("a richer copy replaces the stored one: tier upgrade (fixtures) and corroboration bumps", () => {
    upsertVtis(root, [vti()]); // sample-tier record, no fixtures
    const upgraded = upsertVtis(root, [
      vti({ fixtures: { vulnerable: { snippet: "VULN" }, fixed: { snippet: "FIXED" } } } as any),
    ]);
    expect(upgraded).toMatchObject({ added: 0, updated: 1 });
    expect((loadHiveLot(root)[0] as any).vulnerable.snippet).toBe("VULN");

    // A corroboration bump served WITHOUT fixtures (e.g. a later sample-tier
    // sync) must merge, not clobber: count rises, the trainable payload stays.
    const bumped = upsertVtis(root, [vti({ corroborationCount: 7 } as any)]);
    expect(bumped.updated).toBe(1);
    expect(loadHiveLot(root)[0].corroborationCount).toBe(7);
    expect((loadHiveLot(root)[0] as any).vulnerable.snippet).toBe("VULN");
  });

  it("a poorer copy (no fixtures, same corroboration) never downgrades the lot", () => {
    upsertVtis(root, [vti({ fixtures: { vulnerable: { snippet: "VULN" } } } as any)]);
    const res = upsertVtis(root, [vti()]);
    expect(res).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect((loadHiveLot(root)[0] as any).vulnerable.snippet).toBe("VULN");
  });

  it("loadHiveLot tolerates malformed lines and orders records oldest-first on rewrite", () => {
    upsertVtis(root, [vti({ trapId: "newer", capturedAt: "2026-06-05T00:00:00.000Z" } as any)]);
    const lot = hivePaths(root).feedLot;
    writeFileSync(lot, readFileSync(lot, "utf8") + "{not json\n");
    expect(loadHiveLot(root)).toHaveLength(1);

    upsertVtis(root, [vti({ trapId: "older", capturedAt: "2026-01-01T00:00:00.000Z" } as any)]);
    expect(loadHiveLot(root).map((v) => v.trapId)).toEqual(["older", "newer"]);
  });

  it("cursor state round-trips and tolerates a corrupt file", () => {
    expect(loadCursor(root).cursor).toBeNull();
    saveCursor(root, {
      schemaVersion: "1.0",
      cursor: "2026-06-01T00:00:00.000Z",
      lastSyncAt: "2026-06-02T00:00:00.000Z",
      remote: "https://example.test/api",
      tier: "sample",
      packsSha: null,
      packsSyncedAt: null,
    });
    expect(loadCursor(root)).toMatchObject({ cursor: "2026-06-01T00:00:00.000Z", tier: "sample" });

    writeFileSync(hivePaths(root).cursorFile, "{broken");
    expect(loadCursor(root).cursor).toBeNull();
  });

  it("vtiKey distinguishes sdk versions", () => {
    expect(vtiKey({ trapId: "t", sdk: { name: "stripe", version: "17.0.0" } })).not.toBe(
      vtiKey({ trapId: "t", sdk: { name: "stripe", version: "18.0.0" } }),
    );
  });
});

describe("hive repo linking", () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-"));
    repo = mkdtempSync(join(tmpdir(), "hive-repo-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("extracts deps + devDeps from package.json and names the repo", () => {
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { stripe: "^17.0.0" }, devDependencies: { vitest: "^2.0.0" } }),
    );
    const { name, deps } = extractNpmDeps(repo);
    expect(name).toBe("my-app");
    expect(deps).toEqual({ stripe: "^17.0.0", vitest: "^2.0.0" });
  });

  it("link registers, relink refreshes deps but keeps linkedAt, unlink removes", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "my-app", dependencies: { stripe: "1" } }));
    const first = linkRepo(root, repo, "2026-06-01T00:00:00.000Z");
    expect(first).toMatchObject({ relinked: false, depCount: 1 });

    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "my-app", dependencies: { stripe: "1", jsonwebtoken: "9" } }));
    const second = linkRepo(root, repo, "2026-07-01T00:00:00.000Z");
    expect(second).toMatchObject({ relinked: true, depCount: 2 });
    expect(second.repo.linkedAt).toBe("2026-06-01T00:00:00.000Z");

    expect(unlinkRepo(root, repo)).toBe(true);
    expect(unlinkRepo(root, repo)).toBe(false);
  });

  it("linking a directory without package.json still works (empty dep index)", () => {
    const r = linkRepo(root, repo);
    expect(r.depCount).toBe(0);
    expect(r.repo.name.length).toBeGreaterThan(0);
  });

  it("linking a missing directory throws", () => {
    expect(() => linkRepo(root, join(repo, "nope"))).toThrow(/not found/);
  });
});

describe("hive status", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("summarizes knowledge, freshness, and linked repos", () => {
    upsertVtis(root, [
      vti(),
      vti({ trapId: "jwt-alg-none", severity: "high", class: "auth-bypass", sdk: { name: "jsonwebtoken" } } as any),
    ]);
    writeFileSync(hivePaths(root).experienceLog, '{"e":1}\n{"e":2}\n');
    const s = hiveStatus(root);
    expect(s).toMatchObject({ vtiCount: 2, provenCount: 2, sdkCount: 2, experienceCount: 2 });
    expect(s.severities).toMatchObject({ critical: 1, high: 1 });
    expect(s.newestCapturedAt).toBe("2026-06-01T00:00:00.000Z");

    const text = renderHiveStatusText(s, "2026-06-02T00:00:00.000Z");
    expect(text).toContain("2 VTIs");
    expect(text).toContain("no linked repos");
  });

  it("renders the empty-brain hint for a hive that does not exist yet", () => {
    const s = hiveStatus(join(root, "missing"));
    expect(s.exists).toBe(false);
    expect(renderHiveStatusText(s)).toContain("hive sync");
  });
});
