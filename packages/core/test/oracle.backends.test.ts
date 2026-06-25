import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditWithRule } from "../src/audit.ts";
import { loadRules } from "../src/loadRules.ts";
import { listBundledPacks } from "../src/bundledPacks.ts";
import { staticChecker } from "../src/oracle/backends/staticChecker.ts";
import { compilerBackend } from "../src/oracle/backends/compiler.ts";
import { executedTestBackend } from "../src/oracle/backends/executedTest.ts";
import { differentialBackend } from "../src/oracle/backends/differential.ts";
import { proveRedGreen, proveWithBest, proofMethod } from "../src/oracle/prove.ts";
import {
  parseOracleSelector,
  selectBackends,
  auditWithOracle,
  ALL_BACKENDS,
} from "../src/oracle/index.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

// Map the legacy static result to the two-color oracle scheme — the SAME mapping
// the staticChecker wrapper applies. The seam is a no-op iff this holds on every
// real fixture.
function expectedStaticColor(dir: string, rule: Rule): "RED" | "GREEN" | "UNKNOWN" {
  const checks = auditWithRule(dir, rule);
  if (checks.some((c) => c.result === "fail")) return "RED";
  if (checks.some((c) => c.result === "cant_tell")) return "UNKNOWN";
  return "GREEN";
}

describe("staticChecker backend — the seam is a no-op", () => {
  const packs = listBundledPacks();

  it("there are bundled packs with fixtures to check", () => {
    expect(packs.length).toBeGreaterThan(0);
  });

  for (const p of packs) {
    const rules = loadRules(join(p.dir, "rules"));
    for (const rule of rules) {
      // compiler-only rules can't be judged by the static engine — skip here;
      // they're covered by the compiler-backend tests below.
      if (rule.check.kind === "compiles-against-sdk") continue;
      const base = join(p.dir, "fixtures", rule.id);
      for (const which of ["vulnerable", "fixed"] as const) {
        const dir = join(base, which);
        if (!existsSync(dir)) continue;
        it(`${p.id}/${rule.id}/${which}: static backend === legacy auditWithRule`, async () => {
          const v = await staticChecker.verify({ dir, rule });
          expect(v.method).toBe("static-checker");
          expect(v.color).toBe(expectedStaticColor(dir, rule));
        });
      }
    }
  }
});

describe("compiler backend (Tier 1) — type-checks against the pinned SDK", () => {
  const packDir = join(repoRoot, "packs", "stripe-paymentintents-moved");
  const rule = loadRules(join(packDir, "rules"))[0];
  const base = join(packDir, "fixtures", "stripe-paymentintents-moved");

  it("supports() owns only compiles-against-sdk rules", () => {
    expect(compilerBackend.tier).toBe(1);
    expect(compilerBackend.supports(rule)).toBe(true);
    expect(compilerBackend.supports({ ...rule, check: { kind: "fee-allocation-shape", params: {} } } as Rule)).toBe(false);
  });

  it("verifies RED on the vulnerable fixture (hallucinated API)", async () => {
    const v = await compilerBackend.verify({ dir: join(base, "vulnerable"), rule });
    expect(v.color).toBe("RED");
    expect(v.method).toBe("compiler");
    expect(v.evidence?.code).toMatch(/^TS\d+$/);
  });

  it("verifies GREEN on the fixed fixture", async () => {
    const v = await compilerBackend.verify({ dir: join(base, "fixed"), rule });
    expect(v.color).toBe("GREEN");
  });

  it("abstains (UNKNOWN) when the pinned SDK is not installed", async () => {
    const bogus: Rule = { ...rule, check: { kind: "compiles-against-sdk", params: { sdk: "not-a-real-sdk-xyz", version: "9.9.9" } } };
    const v = await compilerBackend.verify({ dir: join(base, "fixed"), rule: bogus });
    expect(v.color).toBe("UNKNOWN");
    expect(v.detail).toMatch(/not installed/i);
  });
});

describe("proveRedGreen / proveWithBest — the one true gate", () => {
  const packDir = join(repoRoot, "packs", "stripe-paymentintents-moved");
  const rule = loadRules(join(packDir, "rules"))[0];
  const base = join(packDir, "fixtures", "stripe-paymentintents-moved");
  const vuln = join(base, "vulnerable");
  const fixed = join(base, "fixed");

  it("compiler proves RED→GREEN on the seed pack", async () => {
    const r = await proveRedGreen(compilerBackend, vuln, fixed, rule);
    expect(r.proven).toBe(true);
    expect(r.red).toBe(true);
    expect(r.green).toBe(true);
    expect(r.method).toBe("compiler");
  });

  it("static alone cannot prove a compiler trap (it abstains)", async () => {
    const r = await proveRedGreen(staticChecker, vuln, fixed, rule);
    expect(r.proven).toBe(false); // static returns UNKNOWN, never RED, for this kind
  });

  it("proveWithBest skips static and lands on compiler", async () => {
    const result = await proveWithBest(ALL_BACKENDS, vuln, fixed, rule);
    expect(result.proven?.method).toBe("compiler");
    expect(proofMethod(result)).toBe("compiler");
  });
});

describe("oracle selectors + tier gating", () => {
  it("parses aliases", () => {
    expect(parseOracleSelector(undefined)).toBe("static-checker");
    expect(parseOracleSelector("static")).toBe("static-checker");
    expect(parseOracleSelector("compiler")).toBe("compiler");
    expect(parseOracleSelector("executed")).toBe("executed-test");
    expect(parseOracleSelector("diff")).toBe("differential");
    expect(parseOracleSelector("best")).toBe("best");
    expect(() => parseOracleSelector("nonsense")).toThrow(/unknown --oracle/);
  });

  it("best excludes Tier 2 unless opted in", () => {
    const off = selectBackends("best", { allowTier2: false });
    expect(off.maxTier).toBe(1);
    expect(off.backends.some((b) => b.tier === 2)).toBe(false);
    const on = selectBackends("best", { allowTier2: true });
    expect(on.maxTier).toBe(2);
    expect(on.backends.some((b) => b.tier === 2)).toBe(true);
  });
});

describe("Tier 2 backends are wired but abstain (no sandbox in v0.9.0)", () => {
  const rule = { id: "x", test: { kind: "stripe-webhook-signature" }, check: { kind: "differential-io", params: { reference: "ref" } }, detect: {} } as unknown as Rule;

  it("executed-test is tier 2 and returns UNKNOWN, never RED", async () => {
    expect(executedTestBackend.tier).toBe(2);
    const v = await executedTestBackend.verify({ dir: ".", rule, context: "local" });
    expect(v.color).toBe("UNKNOWN");
  });

  it("differential is tier 2 and REFUSES on ingest (UNKNOWN, never a fallback)", async () => {
    expect(differentialBackend.tier).toBe(2);
    const v = await differentialBackend.verify({ dir: ".", rule, context: "ingest" });
    expect(v.color).toBe("UNKNOWN");
    expect(v.detail).toMatch(/hardened ingest sandbox/);
  });
});

describe("auditWithOracle — inline export", () => {
  const packDir = join(repoRoot, "packs", "stripe-paymentintents-moved");
  const rule = loadRules(join(packDir, "rules"))[0];
  const base = join(packDir, "fixtures", "stripe-paymentintents-moved");

  it("compiler oracle returns RED on the vulnerable fixture", async () => {
    const v = await auditWithOracle(join(base, "vulnerable"), rule, { oracle: "compiler" });
    expect(v.color).toBe("RED");
  });

  it("default (static) abstains on a compiler-only rule", async () => {
    const v = await auditWithOracle(join(base, "vulnerable"), rule, { oracle: "static" });
    expect(v.color).toBe("UNKNOWN");
  });
});
