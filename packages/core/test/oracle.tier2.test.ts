import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInSandbox, containerRuntime } from "../src/oracle/sandbox.ts";
import { executedTestBackend } from "../src/oracle/backends/executedTest.ts";
import { differentialBackend } from "../src/oracle/backends/differential.ts";
import { proveRedGreen } from "../src/oracle/prove.ts";
import { loadRules } from "../src/loadRules.ts";
import { rules as bundledRules } from "../rules/index.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const hasContainer = !!containerRuntime();

// ── Sandbox core ──────────────────────────────────────────────────────────────
describe("sandbox — light isolate (context: local)", () => {
  it("kills a runaway (infinite-loop) candidate and reports timeout", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-sbx-loop-"));
    const res = runInSandbox({
      dir,
      command: "node",
      args: ["-e", "while(true){}"],
      context: "local",
      timeoutMs: 800,
    });
    expect(res.status).toBe("timeout");
    expect(res.isolation).toBe("light");
  });

  it("caps runaway output (a print bomb is contained, not scored ok)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-sbx-out-"));
    const res = runInSandbox({
      dir,
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(50000))"],
      context: "local",
      timeoutMs: 5000,
      maxOutputBytes: 1000,
    });
    // Overflow kills the child (ENOBUFS) → "error", and the captured output is
    // bounded by the cap. A backend scores this UNKNOWN, never RED.
    expect(res.status).toBe("error");
    expect(res.stdout.length).toBeLessThan(1200);
    expect(res.stdout).toContain("truncated");
  });
});

describe("sandbox — hardened path (context: ingest) refuses rather than falls back", () => {
  it("refuses (never light-isolates) when no container runtime is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-sbx-ingest-"));
    const res = runInSandbox({
      dir,
      command: "node",
      args: ["-e", "0"],
      context: "ingest",
    });
    // The load-bearing property: ingest is ALWAYS tagged hardened, never light.
    expect(res.isolation).toBe("hardened");
    if (hasContainer) {
      expect(res.status).toBe("ok"); // a real container ran it
    } else {
      expect(res.status).toBe("refused");
      expect(res.detail).toMatch(/refus/i);
    }
  });
});

// ── executed-test backend (behavioral oracle) ─────────────────────────────────
describe("executed-test backend — runs the vetted contract in the sandbox", () => {
  const rule = bundledRules.find((r) => r.id === "stripe-webhook-raw-body-verification")!;
  const stripeFixtures = join(repoRoot, "packages", "core", "fixtures", "stripe");

  it("proves RED→GREEN on the Stripe webhook contract", async () => {
    const r = await proveRedGreen(
      executedTestBackend,
      join(stripeFixtures, "vulnerable"),
      join(stripeFixtures, "fixed"),
      rule,
    );
    expect(r.redVerdict.color).toBe("RED");
    expect(r.greenVerdict.color).toBe("GREEN");
    expect(r.proven).toBe(true);
    expect(r.method).toBe("executed-test");
  }, 120_000);
});

// ── differential backend (reference oracle, golden-I/O) ───────────────────────
describe("differential backend — golden-I/O closes the wrong-constant class", () => {
  const packDir = join(repoRoot, "packs", "solana-lamports-scaling-wrong-constant");
  const rule = loadRules(join(packDir, "rules"))[0];
  const base = join(packDir, "fixtures", "solana-lamports-scaling-wrong-constant");

  it("supports() owns differential-io rules with a golden table", () => {
    expect(differentialBackend.tier).toBe(2);
    expect(differentialBackend.supports(rule)).toBe(true);
    expect(differentialBackend.supports({ ...rule, check: { kind: "fee-allocation-shape", params: {} } } as Rule)).toBe(false);
  });

  it("proves RED→GREEN against the golden table (wrong scaling constant)", async () => {
    const r = await proveRedGreen(differentialBackend, join(base, "vulnerable"), join(base, "fixed"), rule);
    expect(r.redVerdict.color).toBe("RED"); // 1e6 diverges from the golden 1e9
    expect(r.greenVerdict.color).toBe("GREEN");
    expect(r.proven).toBe(true);
  }, 60_000);

  it("a crash/timeout is UNKNOWN, never RED (failure to run is not a proof)", async () => {
    // A candidate that hangs must be killed and scored UNKNOWN.
    const dir = mkdtempSync(join(tmpdir(), "bb-diff-hang-"));
    writeFileSync(join(dir, "lamports.ts"), "export function solToLamports(){ while(true){} }\n");
    const hangRule = { ...rule, check: { ...rule.check, params: { ...rule.check.params, cases: [{ input: [1], output: 1 }], timeoutMs: 2500 } } } as Rule;
    const v = await differentialBackend.verify({ dir, rule: hangRule, context: "local" });
    expect(v.color).toBe("UNKNOWN");
  }, 20_000);

  it("refuses on ingest when no container runtime is available", async () => {
    const v = await differentialBackend.verify({ dir: join(base, "vulnerable"), rule, context: "ingest" });
    if (hasContainer) {
      expect(["RED", "GREEN", "UNKNOWN"]).toContain(v.color);
    } else {
      expect(v.color).toBe("UNKNOWN");
      expect(v.detail).toMatch(/refus/i);
    }
  }, 60_000);
});

// ── Hardened containment (Docker-gated; skips cleanly where unavailable) ───────
describe.skipIf(!hasContainer)("hardened container contains a hostile fixture (context: ingest)", () => {
  it("a fixture that tries the network cannot reach it and is not scored RED", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-hostile-"));
    writeFileSync(
      join(dir, "evil.mjs"),
      "await fetch('http://example.com').then(()=>process.exit(0)).catch(()=>process.exit(7));",
    );
    const res = runInSandbox({ dir, command: "node", args: ["evil.mjs"], context: "ingest", timeoutMs: 10_000 });
    expect(res.isolation).toBe("hardened");
    // --network=none: the fetch fails; the process never confirms egress.
    expect(res.status === "ok" ? res.exitCode : 1).not.toBe(0);
  });
});
