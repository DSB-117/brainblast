import { describe, it, expect, afterEach } from "vitest";
import { cpSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestContribution } from "../src/contrib/ingest.ts";
import { selectBackends } from "../src/oracle/index.ts";
import { proveWithBest } from "../src/oracle/prove.ts";
import { loadPack } from "../src/packs.ts";
import type { Rule } from "../src/types.ts";

// THE KEYSTONE PROOF (v0.9.2): the data factory's intake is no longer bottlenecked
// on its weakest oracle. Before v0.9.2 the reproduction gate was Tier-0 static
// only, so trap classes with no static signature were thrown away. Now intake runs
// the generalized prover, so it captures the classes only Tier-1/2 can prove.
//
// We prove it on two classes:
//   • differential `wrong-constant` (SOL→lamports off 1000×) — no static shape; the
//     prover proves it, the static checker cannot.
//   • compiler (a hallucinated Stripe API) — captured END-TO-END through the full
//     ingest gate, since the compiler oracle executes nothing (safe under ingest).
//
// Tier-2 EXECUTING backends (differential/executed) refuse on the ingest path: the
// hardened-container harness that runs contributor code is a tracked follow-on, so
// they never fall back to light isolation. The prover still proves them locally.

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

const DIFF_PACK = "solana-lamports-scaling-wrong-constant";
const diffPackDir = join(repoRoot, "packs", DIFF_PACK);
const diffSubmission = join(diffPackDir, "fixtures", DIFF_PACK);
const diffRule = (): Rule => loadPack(diffPackDir).rules.find((r) => r.id === DIFF_PACK)!;

const COMPILER_PACK = "stripe-paymentintents-moved";
const compilerPackDir = join(repoRoot, "packs", COMPILER_PACK);
const compilerFixtures = join(compilerPackDir, "fixtures", COMPILER_PACK);
const compilerRule = (): Rule => loadPack(compilerPackDir).rules.find((r) => r.id === COMPILER_PACK)!;

// A clean submission dir (vulnerable/ + fixed/) copied from a pack's fixtures —
// avoids any stray generated files in the pack tree.
function cleanSubmission(fixturesDir: string, file: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-submit-"));
  mkdirSync(join(dir, "vulnerable"), { recursive: true });
  mkdirSync(join(dir, "fixed"), { recursive: true });
  cpSync(join(fixturesDir, "vulnerable", file), join(dir, "vulnerable", file));
  cpSync(join(fixturesDir, "fixed", file), join(dir, "fixed", file));
  return dir;
}

const PRIOR_EXEC = process.env.BRAINBLAST_ORACLE_EXEC;
afterEach(() => {
  if (PRIOR_EXEC === undefined) delete process.env.BRAINBLAST_ORACLE_EXEC;
  else process.env.BRAINBLAST_ORACLE_EXEC = PRIOR_EXEC;
});

describe("keystone: prover-backed intake captures the non-static long tail", () => {
  it("differential trap is REJECTED by intake when Tier-2 is OFF — static alone can't prove it", async () => {
    delete process.env.BRAINBLAST_ORACLE_EXEC; // default: static + compiler only
    const res = await ingestContribution({ submissionDir: diffSubmission, rule: diffRule(), consentScope: "opt-in:train+eval" });
    expect(res.accepted).toBe(false);
    expect(res.proof.red).toBe(false); // static abstains (UNKNOWN) on a wrong-constant
  }, 60_000);

  it("the generalized prover DOES prove the differential trap RED→GREEN (light isolate) — the bottleneck is gone", async () => {
    // Proof the factory can now MANUFACTURE this class. context "local" → light
    // isolate, so it runs everywhere (no container). This is the capability the
    // Tier-0-only intake was throwing away.
    process.env.BRAINBLAST_ORACLE_EXEC = "1";
    const { backends } = selectBackends("best");
    const result = await proveWithBest(
      backends,
      join(diffSubmission, "vulnerable"),
      join(diffSubmission, "fixed"),
      diffRule(),
      "local",
    );
    expect(result.proven?.method).toBe("differential");
  }, 60_000);

  it("a Tier-2 EXECUTING trap REFUSES on the ingest path (never falls back to light isolation)", async () => {
    // The hardened-container harness that runs contributor code is a follow-on;
    // until then differential/executed refuse under context:"ingest". Safe by
    // construction — and fast (no container attempt).
    process.env.BRAINBLAST_ORACLE_EXEC = "1";
    const res = await ingestContribution({ submissionDir: diffSubmission, rule: diffRule(), consentScope: "opt-in:train+eval" });
    expect(res.accepted).toBe(false);
  }, 60_000);

  it("a COMPILER trap is CAPTURED end-to-end through the full ingest gate (method=compiler)", async () => {
    // The compiler oracle executes nothing (reads source + types), so it is safe
    // under context:"ingest" and needs no Tier-2 opt-in. This is a non-static class
    // the old Tier-0-only intake could NOT capture — now it flows through ingest.
    delete process.env.BRAINBLAST_ORACLE_EXEC;
    const submissionDir = cleanSubmission(compilerFixtures, "charge.ts");
    const res = await ingestContribution({ submissionDir, rule: compilerRule(), consentScope: "opt-in:train+eval" });
    expect(res.accepted).toBe(true);
    expect(res.method).toBe("compiler");
    expect((res.vti as any)?.redGreenProof.method).toBe("compiler");
    expect((res.vti as any)?.schemaVersion).toBe("1.1");
  }, 60_000);
});
