import { describe, it, expect } from "vitest";
import { scoreFromProgram, scoreProgram, gradeForScore, gradeAtLeast, renderScoreText } from "../src/score.ts";
import type { OnChainProgram } from "../src/trustGraph/types.ts";

const SYSTEM = "11111111111111111111111111111111";

function program(overrides: Partial<OnChainProgram>): OnChainProgram {
  return {
    programId: "Prog1111111111111111111111111111111111111111",
    name: "Test Program",
    upgradeAuthority: { kind: "single-key", address: "Auth111", source: "rpc" },
    verifiedBuild: { state: "unknown" },
    audits: [],
    parity: { mainnet: "unknown", devnet: "unknown" },
    ...overrides,
  };
}

describe("gradeForScore", () => {
  it("maps score ranges to grades", () => {
    expect(gradeForScore(95)).toBe("A");
    expect(gradeForScore(80)).toBe("B");
    expect(gradeForScore(65)).toBe("C");
    expect(gradeForScore(45)).toBe("D");
    expect(gradeForScore(20)).toBe("F");
  });
});

describe("scoreFromProgram", () => {
  it("grades a renounced, verified, audited, curated program highly (A)", () => {
    const p = program({
      upgradeAuthority: { kind: "renounced", address: null, source: "directory" },
      verifiedBuild: { state: "verified", registryUrl: "https://verify.osec.io/x" },
      audits: [
        { firm: "OtterSec", date: "2024-01-01", reportUrl: "https://x" },
        { firm: "Neodyme", date: "2024-02-01", reportUrl: "https://y" },
      ],
      parity: { mainnet: "present", devnet: "present" },
      provenance: { directoryFile: "directory.yaml" },
    });
    const s = scoreFromProgram(p);
    expect(s.score).toBe(100);
    expect(s.grade).toBe("A");
  });

  it("grades a single-key, unverified, unaudited, uncurated program poorly (F)", () => {
    const p = program({
      upgradeAuthority: { kind: "single-key", address: "Hot111", source: "rpc" },
      verifiedBuild: { state: "unverified" },
      audits: [],
      parity: { mainnet: "absent", devnet: "present" },
    });
    const s = scoreFromProgram(p);
    // 8 (single-key) + 2 (unverified) + 0 (no audits) + 0 (uncurated) + 0 (parity) = 10
    expect(s.score).toBe(10);
    expect(s.grade).toBe("F");
  });

  it("rewards a multisig authority over a single key", () => {
    const single = scoreFromProgram(program({ upgradeAuthority: { kind: "single-key", address: "k", source: "rpc" } }));
    const multi = scoreFromProgram(program({ upgradeAuthority: { kind: "multisig", address: "k", source: "rpc" } }));
    expect(multi.score!).toBeGreaterThan(single.score!);
  });

  it("includes a factor breakdown summing to the score", () => {
    const s = scoreFromProgram(program({}));
    const sum = s.factors.reduce((a, f) => a + f.points, 0);
    expect(sum).toBe(s.score);
    expect(s.factors).toHaveLength(5);
  });
});

describe("gradeAtLeast", () => {
  it("compares grades", () => {
    expect(gradeAtLeast("A", "B")).toBe(true);
    expect(gradeAtLeast("C", "B")).toBe(false);
    expect(gradeAtLeast("B", "B")).toBe(true);
    expect(gradeAtLeast("unrated", "F")).toBe(false);
  });
});

describe("scoreProgram (integration, offline directory)", () => {
  it("resolves and scores a curated directory program without RPC", async () => {
    const s = await scoreProgram(SYSTEM, { probeRpc: false, cachePath: null });
    expect(s.resolved).toBe(true);
    expect(typeof s.score).toBe("number");
    expect(["A", "B", "C", "D", "F"]).toContain(s.grade);
  });

  it("returns unrated for an unresolvable program with RPC disabled", async () => {
    const fake = "Fake1111111111111111111111111111111111111111";
    const s = await scoreProgram(fake, { probeRpc: false, cachePath: null });
    expect(s.resolved).toBe(false);
    expect(s.grade).toBe("unrated");
    expect(s.score).toBeNull();
  });
});

describe("renderScoreText", () => {
  it("renders grade, score, and factors", () => {
    const text = renderScoreText(scoreFromProgram(program({})));
    expect(text).toContain("Trust score");
    expect(text).toContain("Upgrade authority");
  });
});
