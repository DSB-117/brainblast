import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: bench.ts graded candidates with the STATIC checker only
// (auditWithRule), but the eval set (loadEvalSet) admits any trap the
// oracle-aware validatePack proves "ok" — including compiler/behavioral-only
// traps with no static shape by design (e.g. stripe-paymentintents-moved,
// check.kind "compiles-against-sdk"). A static-only grade always scored those
// as falsely "avoided" regardless of the candidate, silently breaking
// `npm run bench -- --self-test`'s own vulnerable-baseline guarantee. Fixed by
// grading through auditWithOracle (best backend), the same prover the rest of
// the pipeline (gen-vti, corpus-sla, fleet) already routes through.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const benchScript = resolve(here, "..", "scripts", "bench.ts");

describe("bench --self-test", () => {
  it("passes: every proven trap is caught on its vulnerable fixture, none on fixed", () => {
    let stdout = "";
    let status = 0;
    try {
      stdout = execFileSync("npx", ["tsx", benchScript, "--self-test"], {
        cwd: resolve(repoRoot, "packages", "core"),
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e: any) {
      stdout = (e.stdout ?? "") + (e.stderr ?? "");
      status = e.status ?? 1;
    }

    expect(stdout).toContain("vulnerable baseline: 0/");
    expect(stdout).toContain("fixed baseline:");
    expect(stdout).toContain("oracle verified");
    expect(status).toBe(0);
  }, 30_000);
});
