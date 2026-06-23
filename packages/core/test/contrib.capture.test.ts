import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isContributeEnabled,
  contributeConsentScope,
  stageContribution,
  listStagedContributions,
} from "../src/contrib/capture.ts";
import { ingestCandidate } from "../src/contrib/ingest.ts";
import { loadPack } from "../src/packs.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const PACK = "metaplex-nft-royalty-zero";
const fixtures = join(repoRoot, "packs", PACK, "fixtures", PACK);
function rule(): Rule {
  return loadPack(join(repoRoot, "packs", PACK)).rules.find((r) => r.id === PACK)!;
}
function project(config?: object): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-contrib-"));
  if (config) {
    mkdirSync(join(dir, ".agent-research"), { recursive: true });
    writeFileSync(join(dir, ".agent-research", "config.json"), JSON.stringify(config));
  }
  return dir;
}

describe("contribution capture (opt-in)", () => {
  it("is OFF by default — no config, no env", () => {
    delete process.env.BRAINBLAST_CONTRIBUTE;
    expect(isContributeEnabled(project())).toBe(false);
  });

  it("does not stage when disabled (default)", () => {
    delete process.env.BRAINBLAST_CONTRIBUTE;
    const dir = project();
    const res = stageContribution(dir, { ruleId: PACK, file: "x.ts", vulnerable: "a", fixed: "b" });
    expect(res.staged).toBe(false);
    expect(listStagedContributions(dir)).toHaveLength(0);
  });

  it("enables via config and stages a clean pair", () => {
    delete process.env.BRAINBLAST_CONTRIBUTE;
    const dir = project({ contribute: { enabled: true, consentScope: "opt-in:eval" } });
    expect(isContributeEnabled(dir)).toBe(true);
    expect(contributeConsentScope(dir)).toBe("opt-in:eval");
    const res = stageContribution(dir, { ruleId: PACK, file: "mint.ts", vulnerable: "const a=1;", fixed: "const a=2;" });
    expect(res.staged).toBe(true);
    const staged = listStagedContributions(dir);
    expect(staged).toHaveLength(1);
    expect(staged[0].rec.consentScope).toBe("opt-in:eval");
  });

  it("REFUSES to stage a pair containing a secret (never written to disk)", () => {
    const dir = project({ contribute: true });
    const keypair = JSON.stringify(Array.from({ length: 64 }, (_, i) => i % 256));
    const res = stageContribution(dir, { ruleId: PACK, file: "id.json", vulnerable: keypair, fixed: "ok" });
    expect(res.staged).toBe(false);
    expect(res.reason).toMatch(/secret/i);
    expect(existsSync(join(dir, ".agent-research", "contrib-staging"))).toBe(false);
  });
});

describe("ingestCandidate (drain path)", () => {
  it("ACCEPTS a reproducing captured pair from the real fixtures", () => {
    const vulnerable = readFileSync(join(fixtures, "vulnerable", "mint.ts"), "utf8");
    const fixed = readFileSync(join(fixtures, "fixed", "mint.ts"), "utf8");
    const res = ingestCandidate({
      rule: rule(),
      file: "mint.ts",
      vulnerableSource: vulnerable,
      fixedSource: fixed,
      consentScope: "opt-in:train+eval",
      now: "2026-06-23T00:00:00.000Z",
    });
    expect(res.accepted).toBe(true);
    expect(res.proof).toEqual({ red: true, green: true });
    expect(res.vti?.license).toBe("contributor-grant-v1");
  });

  it("REJECTS a captured pair that does not reproduce RED", () => {
    const fixed = readFileSync(join(fixtures, "fixed", "mint.ts"), "utf8");
    const res = ingestCandidate({
      rule: rule(),
      file: "mint.ts",
      vulnerableSource: fixed, // already-fixed code on the vulnerable side
      fixedSource: fixed,
      consentScope: "opt-in:train+eval",
    });
    expect(res.accepted).toBe(false);
    expect(res.proof.red).toBe(false);
  });
});
