import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDemandSignal, renderDemandText, statsPath, writeDemandSignal } from "../src/hive/stats.ts";
import type { ExperienceEvent } from "../src/hive/experience.ts";
import type { CorpusVti } from "../src/corpus.ts";

const event = (ruleId: string, repoPath: string): ExperienceEvent => ({
  ruleId,
  repoPath,
  repoName: repoPath.split("/").pop() ?? repoPath,
  file: "src/x.ts",
  exportName: "fn",
  fixedAt: "2026-07-01",
  detail: "d",
});

const vti = (trapId: string, cls: string, sdk: string): CorpusVti =>
  ({ trapId, sdk: { name: sdk }, severity: "high", class: cls, redGreenProof: { red: true, green: true } }) as CorpusVti;

describe("hive demand signal", () => {
  it("aggregates fix events by rule and resolves class/sdk via the hive lot", () => {
    const d = buildDemandSignal(
      [event("jwt-alg-none", "/a"), event("jwt-alg-none", "/b"), event("mystery-rule", "/a")],
      [vti("jwt-alg-none", "auth-bypass", "jsonwebtoken")],
    );
    expect(d).toMatchObject({
      totalFixEvents: 3,
      repos: 2,
      byRule: { "jwt-alg-none": 2, "mystery-rule": 1 },
      byClass: { "auth-bypass": 2 },
      bySdk: { jsonwebtoken: 2 },
      unresolvedRules: ["mystery-rule"],
    });
  });

  it("contains counts only — no files, exports, or details leak into the signal", () => {
    const d = buildDemandSignal([event("r", "/private/work/secret-project")], []);
    const flat = JSON.stringify(d);
    expect(flat).not.toContain("src/x.ts");
    expect(flat).not.toContain("secret-project");
    expect(flat).not.toContain("fn");
  });

  it("writes stats.json into the hive and renders a readable summary", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-stats-"));
    try {
      const d = buildDemandSignal([event("r1", "/a")], [], "2026-07-08T00:00:00.000Z");
      const p = writeDemandSignal(root, d);
      expect(p).toBe(statsPath(root));
      expect(JSON.parse(readFileSync(p, "utf8"))).toMatchObject({ totalFixEvents: 1, generatedAt: "2026-07-08T00:00:00.000Z" });
      expect(renderDemandText(d)).toContain("1 fix event across 1 repo");

      const empty = buildDemandSignal([], []);
      expect(renderDemandText(empty)).toContain("empty");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
