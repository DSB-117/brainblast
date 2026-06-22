import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldPolicy, loadPolicy, normalizePolicy, DEFAULT_POLICY } from "../src/signguard/policy.ts";
import { loadSession, recordSpend, resetSession } from "../src/signguard/session.ts";

describe("policy: scaffold + load + normalize", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sgpol-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("scaffolds a secure-default policy and loads it back", () => {
    const path = scaffoldPolicy(dir);
    expect(existsSync(path)).toBe(true);
    const { policy, source } = loadPolicy({ cwd: dir });
    expect(source).toBe(path);
    expect(policy.maxSolPerTx).toBe(DEFAULT_POLICY.maxSolPerTx);
    expect(policy.actions.setAuthority).toBe("block");
  });

  it("refuses to overwrite an existing policy", () => {
    scaffoldPolicy(dir);
    expect(() => scaffoldPolicy(dir)).toThrow(/already exists/);
  });

  it("falls back to built-in defaults when no policy file exists", () => {
    const { policy, source } = loadPolicy({ cwd: dir });
    expect(source).toMatch(/built-in/);
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it("merges a partial policy over secure defaults (can't silently disable protections)", () => {
    const p = normalizePolicy({ maxSolPerTx: 10 });
    expect(p.maxSolPerTx).toBe(10);
    expect(p.blockUnknownPrograms).toBe(true); // untouched default preserved
    expect(p.actions.programUpgrade).toBe("block");
  });
});

describe("session ledger", () => {
  let vdir: string;
  let prev: string | undefined;
  beforeEach(() => {
    vdir = mkdtempSync(join(tmpdir(), "sgses-"));
    prev = process.env.BRAINBLAST_SIGNGUARD_DIR;
    process.env.BRAINBLAST_SIGNGUARD_DIR = vdir;
  });
  afterEach(() => {
    rmSync(vdir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.BRAINBLAST_SIGNGUARD_DIR;
    else process.env.BRAINBLAST_SIGNGUARD_DIR = prev;
  });

  it("accumulates spend and resets", () => {
    expect(loadSession().solOut).toBe(0);
    recordSpend(1.5);
    recordSpend(2.0);
    const s = loadSession();
    expect(s.solOut).toBeCloseTo(3.5);
    expect(s.txCount).toBe(2);
    resetSession();
    expect(loadSession().solOut).toBe(0);
  });
});
