import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, "..", "..", "..", "scripts", "brainblast-gate.sh");

function runGate(args: string[]): number {
  try {
    execFileSync("sh", [GATE, ...args], { stdio: "pipe" });
    return 0;
  } catch (e: any) {
    return typeof e?.status === "number" ? e.status : -1;
  }
}

let dir: string;
const write = (name: string, obj: unknown): string => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj));
  return p;
};

// A checks-bearing report at one result.
const checksReport = (result: "pass" | "fail" | "cant_tell") => ({
  summary: { verdict: result === "fail" ? "blocked" : "ready" },
  checks: [{ ruleId: "r", severity: "critical", result, title: "t" }],
  checkTotals: {
    pass: result === "pass" ? 1 : 0,
    fail: result === "fail" ? 1 : 0,
    cant_tell: result === "cant_tell" ? 1 : 0,
  },
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bb-gate-"));
});

describe("brainblast-gate.sh (D4 semantics)", () => {
  it("exit 1 on a confirmed FAIL", () => {
    expect(runGate([write("fail.json", checksReport("fail")), "--quiet"])).toBe(1);
  });

  it("exit 0 on PASS", () => {
    expect(runGate([write("pass.json", checksReport("pass")), "--quiet"])).toBe(0);
  });

  it("exit 0 on CANT_TELL by default (warning, not gating)", () => {
    expect(runGate([write("ct.json", checksReport("cant_tell")), "--quiet"])).toBe(0);
  });

  it("exit 1 on CANT_TELL with --strict", () => {
    expect(runGate([write("ct2.json", checksReport("cant_tell")), "--strict", "--quiet"])).toBe(1);
  });

  it("exit 1 on legacy riskTotals critical (backward compat)", () => {
    const r = { summary: { verdict: "blocked" }, riskTotals: { critical: 1, high: 0, medium: 0, low: 0 } };
    expect(runGate([write("legacy.json", r), "--quiet"])).toBe(1);
  });

  it("exit 0 on legacy riskTotals all-zero, verdict ready", () => {
    const r = { summary: { verdict: "ready" }, riskTotals: { critical: 0, high: 0, medium: 0, low: 0 } };
    expect(runGate([write("legacy0.json", r), "--quiet"])).toBe(0);
  });

  it("exit 2 on a missing report", () => {
    expect(runGate(["/no/such/report.json"])).toBe(2);
  });

  it("exit 2 on a bad --fail-on value", () => {
    expect(runGate([write("p2.json", checksReport("pass")), "--fail-on=banana"])).toBe(2);
  });
});
