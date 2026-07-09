import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleBrief, matchDep, renderBriefText, renderBriefMarkdown } from "../src/hive/brief.ts";
import { agentInstructionFile, injectBlock, removeBlock, HIVE_BLOCK_BEGIN, HIVE_BLOCK_END } from "../src/hive/inject.ts";
import { dedupeVtis, resolveRecallLotPaths, recallFeed } from "../src/feedLots.ts";
import { hivePaths, upsertVtis, HIVE_DIR_ENV } from "../src/hive/store.ts";
import type { CorpusVti } from "../src/corpus.ts";

function vti(over: Record<string, unknown> = {}): CorpusVti {
  return {
    trapId: "stripe-webhook-raw-body",
    sdk: { name: "stripe", version: "17.0.0" },
    severity: "critical",
    class: "auth-bypass",
    corroborationCount: 3,
    redGreenProof: { red: true, green: true, method: "static-checker" },
    license: "synthetic-owned",
    capturedAt: "2026-06-01T00:00:00.000Z",
    sourceUrls: ["https://docs.stripe.com/webhooks"],
    vulnerable: { snippet: "app.use(express.json()); stripe.webhooks.constructEvent(req.body, sig, secret)" },
    fixed: { snippet: "app.use('/webhook', express.raw({type: 'application/json'}))" },
    ...over,
  } as CorpusVti;
}

const DEPS = { stripe: "^17.0.0", jsonwebtoken: "^9.0.0", vitest: "^2.0.0" };

describe("hive brief assembly", () => {
  it("matches deps exactly (case-insensitive), never by substring", () => {
    expect(matchDep(DEPS, "stripe")).toBe("stripe");
    expect(matchDep(DEPS, "STRIPE")).toBe("stripe");
    expect(matchDep(DEPS, "strip")).toBeUndefined();
    expect(matchDep(DEPS, "jose")).toBeUndefined();
  });

  it("briefs only proven traps for matching deps, with honesty counts", () => {
    const brief = assembleBrief({
      deps: DEPS,
      vtis: [
        vti(),
        vti({ trapId: "jwt-alg-none", sdk: { name: "jsonwebtoken" }, severity: "high" }),
        vti({ trapId: "unproven", redGreenProof: { red: true, green: false } }), // never enters a brief
        vti({ trapId: "other-sdk", sdk: { name: "express-session" } }), // not a dep here
      ],
    });
    expect(brief.entries.map((e) => e.trapId)).toEqual(["stripe-webhook-raw-body", "jwt-alg-none"]);
    expect(brief.matchedDeps).toEqual(["jsonwebtoken", "stripe"]);
    expect(brief.unmatchedDepCount).toBe(1); // vitest has nothing on file
    expect(brief.entries[0].avoid).toContain("express.json()");
    expect(brief.entries[0].instead).toContain("express.raw");
  });

  it("ranks by score (severity × corroboration) and respects the budget cap", () => {
    const brief = assembleBrief({
      deps: DEPS,
      vtis: [
        vti({ trapId: "low-corr", title: "trap A", corroborationCount: 0, severity: "high" }),
        vti({ trapId: "hot", title: "trap B", corroborationCount: 9, severity: "critical" }),
        vti({ trapId: "mid", title: "trap C", corroborationCount: 1, severity: "high" }),
      ],
      maxRecords: 2,
    });
    expect(brief.entries.map((e) => e.trapId)).toEqual(["hot", "mid"]);
    expect(brief.totalMatched).toBe(3);
    expect(brief.truncated).toBe(1);
  });

  it("focuses on one sdk and filters by minimum severity", () => {
    const vtis = [vti(), vti({ trapId: "jwt-med", sdk: { name: "jsonwebtoken" }, severity: "medium" })];
    const focused = assembleBrief({ deps: DEPS, vtis, sdk: "jsonwebtoken" });
    expect(focused.entries.map((e) => e.trapId)).toEqual(["jwt-med"]);
    const sevGated = assembleBrief({ deps: DEPS, vtis, minSeverity: "high" });
    expect(sevGated.entries.map((e) => e.trapId)).toEqual(["stripe-webhook-raw-body"]);
  });

  it("trims oversized snippets", () => {
    const brief = assembleBrief({
      deps: DEPS,
      vtis: [vti({ vulnerable: { snippet: "x".repeat(1000) } })],
      maxSnippetChars: 100,
    });
    expect(brief.entries[0].avoid!.length).toBeLessThan(130);
    expect(brief.entries[0].avoid).toContain("(trimmed)");
  });

  it("renders the honesty line on every surface, including the empty brief", () => {
    const empty = assembleBrief({ deps: DEPS, vtis: [] });
    expect(renderBriefText(empty)).toContain("NOT that they are safe");
    expect(renderBriefMarkdown(empty)).toContain("NOT that they are safe");

    const full = assembleBrief({ deps: DEPS, vtis: [vti()] });
    const text = renderBriefText(full);
    expect(text).toContain("stripe-webhook-raw-body");
    expect(text).toContain("corroborated in 3 repos");
    const md = renderBriefMarkdown(full, { syncedAt: "2026-06-02T00:00:00.000Z", tier: "standard" });
    expect(md).toContain("### `stripe`");
    expect(md).toContain("tier standard");
  });
});

describe("hive briefing injection", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "hive-inject-"));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("prefers CLAUDE.md, falls back to AGENTS.md, defaults to CLAUDE.md", () => {
    expect(agentInstructionFile(repo)).toBe(join(repo, "CLAUDE.md"));
    writeFileSync(join(repo, "AGENTS.md"), "# agents\n");
    expect(agentInstructionFile(repo)).toBe(join(repo, "AGENTS.md"));
    writeFileSync(join(repo, "CLAUDE.md"), "# claude\n");
    expect(agentInstructionFile(repo)).toBe(join(repo, "CLAUDE.md"));
  });

  it("creates, refreshes idempotently, and preserves surrounding content", () => {
    const file = join(repo, "CLAUDE.md");
    writeFileSync(file, "# My project\n\nHand-written notes.\n");

    expect(injectBlock(file, "briefing v1")).toBe("updated");
    const v1 = readFileSync(file, "utf8");
    expect(v1).toContain("Hand-written notes.");
    expect(v1).toContain("briefing v1");
    expect(v1.indexOf(HIVE_BLOCK_BEGIN)).toBeGreaterThan(v1.indexOf("Hand-written"));

    expect(injectBlock(file, "briefing v1")).toBe("unchanged");
    expect(injectBlock(file, "briefing v2")).toBe("updated");
    const v2 = readFileSync(file, "utf8");
    expect(v2).toContain("briefing v2");
    expect(v2).not.toContain("briefing v1");
    expect(v2.match(new RegExp(HIVE_BLOCK_END, "g"))).toHaveLength(1);
  });

  it("creates the file when missing and removal restores the original", () => {
    const file = join(repo, "CLAUDE.md");
    expect(injectBlock(file, "brief")).toBe("created");
    expect(existsSync(file)).toBe(true);

    writeFileSync(file, "# kept\n\n" + readFileSync(file, "utf8"));
    expect(removeBlock(file)).toBe(true);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("# kept");
    expect(after).not.toContain(HIVE_BLOCK_BEGIN);
    expect(removeBlock(file)).toBe(false);
  });
});

describe("recall reads the hive by default", () => {
  let hive: string;
  let cwd: string;
  const envBefore = process.env[HIVE_DIR_ENV];
  beforeEach(() => {
    hive = mkdtempSync(join(tmpdir(), "hive-recall-"));
    cwd = mkdtempSync(join(tmpdir(), "hive-recall-cwd-"));
    process.env[HIVE_DIR_ENV] = hive;
  });
  afterEach(() => {
    if (envBefore === undefined) delete process.env[HIVE_DIR_ENV];
    else process.env[HIVE_DIR_ENV] = envBefore;
    rmSync(hive, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("resolveRecallLotPaths includes the hive lot when it exists; explicit lots win", () => {
    expect(resolveRecallLotPaths([])).toEqual([]);
    upsertVtis(hive, [vti()]);
    expect(resolveRecallLotPaths([])).toEqual([hivePaths(hive).feedLot]);
    expect(resolveRecallLotPaths(["explicit.jsonl"])).toEqual(["explicit.jsonl"]);
  });

  it("recallFeed surfaces hive knowledge with full visibility", () => {
    upsertVtis(hive, [vti({ trapId: "hive-only", sdk: { name: "jsonwebtoken" } })]);
    const { result, lots } = recallFeed({ sdk: "jsonwebtoken" });
    expect(lots).toContain(hivePaths(hive).feedLot);
    expect(result.records.map((r) => r.trapId)).toEqual(["hive-only"]);
    expect(result.records[0].fixtures?.vulnerable?.snippet).toBeDefined();
  });

  it("dedupeVtis keeps the richer copy across overlapping lots", () => {
    const bare = vti({ vulnerable: undefined, fixed: undefined, corroborationCount: 5 });
    const rich = vti({ corroborationCount: 1 });
    const deduped = dedupeVtis([bare, rich]);
    expect(deduped).toHaveLength(1);
    expect((deduped[0] as any).vulnerable?.snippet).toBeDefined();

    const bumped = dedupeVtis([rich, vti({ corroborationCount: 9 })]);
    expect(bumped).toHaveLength(1);
    expect(bumped[0].corroborationCount).toBe(9);
  });
});

describe("fleet-scale briefs — pattern-duplicate collapse (v0.12.0)", () => {
  it("collapses same-SDK same-title instances into one entry carrying breadth", () => {
    const instances = ["parabol", "gravitee", "fallow", "borg-ui"].map((repo, i) =>
      vti({
        trapId: `${repo}-algorithm-none`,
        title: 'jwt.sign with algorithm "none" issues unsigned tokens',
        sdk: { name: "jsonwebtoken" },
        corroborationCount: i, // best corroboration must win
      }),
    );
    const distinct = vti({
      trapId: "jwt-verify-algorithm-none",
      title: "jwt.verify accepts the none algorithm",
      sdk: { name: "jsonwebtoken" },
    });
    const brief = assembleBrief({ deps: { jsonwebtoken: "^9" }, vtis: [...instances, distinct] });
    expect(brief.totalMatched).toBe(2); // 4 instances → 1 group, plus the distinct trap
    const group = brief.entries.find((e) => e.instances === 4)!;
    expect(group.corroborationCount).toBe(3);
    expect(renderBriefText(brief)).toContain("pattern found in 4 real repos");
  });

  it("keeps the richest representative: fixtures from any instance survive the collapse", () => {
    const bare = vti({ trapId: "a-x", title: "same trap", vulnerable: undefined, fixed: undefined });
    const rich = vti({ trapId: "b-x", title: "same trap" });
    const brief = assembleBrief({ deps: { stripe: "^17" }, vtis: [bare, rich] });
    expect(brief.entries).toHaveLength(1);
    expect(brief.entries[0].avoid).toBeDefined();
  });
});
