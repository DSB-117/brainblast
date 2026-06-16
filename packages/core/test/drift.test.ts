import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDrift, renderDriftText, type DriftPackage, type DriftResult } from "../src/drift.ts";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "bb-drift-"));
}

function mockOsv(results: Array<Array<{ id: string; severity?: string; summary?: string }>>) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      results: results.map((vulns) => ({
        vulns: vulns.map((v) => ({
          id: v.id,
          summary: v.summary ?? `Advisory ${v.id}`,
          severity: v.severity
            ? [{ type: "CVSS_V3", score: v.severity === "critical" ? "9.5" : v.severity === "high" ? "8.0" : "4.0" }]
            : [],
        })),
      })),
    }),
  } as unknown as Response);
}

const pkg1: DriftPackage = { name: "lodash", version: "4.17.20", ecosystem: "npm", source: "package-lock.json" };
const pkg2: DriftPackage = { name: "axios", version: "0.21.0", ecosystem: "npm", source: "package-lock.json" };

describe("drift alerting — checkDrift", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a baseline on first run and reports baselineExists=false", async () => {
    const dir = tmpDir();
    mockOsv([[{ id: "GHSA-p6mc-m468-83gw", severity: "high" }]]);

    const result = await checkDrift(dir, { packages: [pkg1] });

    expect(result.baselineExists).toBe(false);
    expect(result.newAdvisories).toHaveLength(0);
    expect(result.packagesChecked).toBe(1);
    expect(existsSync(join(dir, ".agent-research", "drift-baseline.json"))).toBe(true);
  });

  it("reports no new advisories when advisory set is unchanged", async () => {
    const dir = tmpDir();

    // Run 1 — seed baseline with one advisory.
    mockOsv([[{ id: "GHSA-aaa", severity: "high" }]]);
    await checkDrift(dir, { packages: [pkg1] });

    // Run 2 — same advisory.
    mockOsv([[{ id: "GHSA-aaa", severity: "high" }]]);
    const result = await checkDrift(dir, { packages: [pkg1] });

    expect(result.baselineExists).toBe(true);
    expect(result.newAdvisories).toHaveLength(0);
    expect(result.resolvedAdvisories).toHaveLength(0);
  });

  it("reports a new advisory that appeared since baseline", async () => {
    const dir = tmpDir();

    // Run 1 — no advisories.
    mockOsv([[]]);
    await checkDrift(dir, { packages: [pkg1] });

    // Run 2 — new advisory.
    mockOsv([[{ id: "GHSA-new", severity: "high" }]]);
    const result = await checkDrift(dir, { packages: [pkg1] });

    expect(result.baselineExists).toBe(true);
    expect(result.newAdvisories).toHaveLength(1);
    expect(result.newAdvisories[0].id).toBe("GHSA-new");
    expect(result.newAdvisories[0].package).toBe("lodash");
    expect(result.resolvedAdvisories).toHaveLength(0);
  });

  it("reports a resolved advisory that disappeared since baseline", async () => {
    const dir = tmpDir();

    // Run 1 — has an advisory.
    mockOsv([[{ id: "GHSA-old", severity: "critical" }]]);
    await checkDrift(dir, { packages: [pkg1] });

    // Run 2 — advisory gone.
    mockOsv([[]]);
    const result = await checkDrift(dir, { packages: [pkg1] });

    expect(result.baselineExists).toBe(true);
    expect(result.newAdvisories).toHaveLength(0);
    expect(result.resolvedAdvisories).toHaveLength(1);
    expect(result.resolvedAdvisories[0].id).toBe("GHSA-old");
  });

  it("--updateBaseline resets the baseline to the current state", async () => {
    const dir = tmpDir();

    // Run 1 — baseline with GHSA-old.
    mockOsv([[{ id: "GHSA-old" }]]);
    await checkDrift(dir, { packages: [pkg1] });

    // Force-update baseline to GHSA-new only.
    mockOsv([[{ id: "GHSA-new" }]]);
    await checkDrift(dir, { packages: [pkg1], updateBaseline: true });

    // Run 3 — GHSA-new is now baseline; should report nothing new.
    mockOsv([[{ id: "GHSA-new" }]]);
    const result = await checkDrift(dir, { packages: [pkg1] });

    expect(result.newAdvisories).toHaveLength(0);
  });

  it("handles multiple packages and identifies new advisory on second package", async () => {
    const dir = tmpDir();
    const pkgs = [pkg1, pkg2];

    // Run 1 — no advisories.
    mockOsv([[], []]);
    await checkDrift(dir, { packages: pkgs });

    // Run 2 — new advisory on second package.
    mockOsv([[], [{ id: "GHSA-body", severity: "high" }]]);
    const result = await checkDrift(dir, { packages: pkgs });

    expect(result.newAdvisories).toHaveLength(1);
    expect(result.newAdvisories[0].package).toBe("axios");
    expect(result.packagesChecked).toBe(2);
  });
});

describe("drift alerting — renderDriftText", () => {
  it("renders baseline-created message on first run", () => {
    const result: DriftResult = {
      newAdvisories: [], resolvedAdvisories: [],
      baselineExists: false, baselineDate: null, packagesChecked: 42,
    };
    const text = renderDriftText(result);
    expect(text).toContain("baseline created");
    expect(text).toContain("42 packages");
  });

  it("renders no-change message when nothing new", () => {
    const result: DriftResult = {
      newAdvisories: [], resolvedAdvisories: [],
      baselineExists: true, baselineDate: "2026-01-01T00:00:00Z", packagesChecked: 10,
    };
    const text = renderDriftText(result);
    expect(text).toContain("No new advisories");
  });

  it("renders new advisory details", () => {
    const result: DriftResult = {
      newAdvisories: [{
        id: "GHSA-test", severity: "critical", summary: "RCE via prototype pollution",
        url: "https://osv.dev/vulnerability/GHSA-test", package: "foo", ecosystem: "npm", version: "1.0.0",
      }],
      resolvedAdvisories: [],
      baselineExists: true, baselineDate: "2026-01-01T00:00:00Z", packagesChecked: 1,
    };
    const text = renderDriftText(result);
    expect(text).toContain("CRITICAL");
    expect(text).toContain("foo@1.0.0");
    expect(text).toContain("GHSA-test");
  });
});
