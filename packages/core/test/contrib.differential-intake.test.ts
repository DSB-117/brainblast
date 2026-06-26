import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestContribution } from "../src/contrib/ingest.ts";
import { selectBackends } from "../src/oracle/index.ts";
import { proveWithBest } from "../src/oracle/prove.ts";
import { containerRuntime } from "../src/oracle/sandbox.ts";
import { loadPack } from "../src/packs.ts";
import type { Rule } from "../src/types.ts";

// THE KEYSTONE PROOF (v0.9.2): the data factory's intake is no longer bottlenecked
// on its weakest oracle. A `wrong-constant` differential trap — a SOL→lamports
// converter off by 1000× — has NO static signature. The Tier-0 static checker the
// factory used before THROWS IT AWAY; the generalized prover, now wired into
// ingest, CAPTURES it. This file proves both halves of that claim.

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const PACK = "solana-lamports-scaling-wrong-constant";
const packDir = join(repoRoot, "packs", PACK);
const submissionDir = join(packDir, "fixtures", PACK); // contains vulnerable/ + fixed/
const hasContainer = !!containerRuntime();

function diffRule(): Rule {
  return loadPack(packDir).rules.find((r) => r.id === PACK)!;
}

const PRIOR_EXEC = process.env.BRAINBLAST_ORACLE_EXEC;
afterEach(() => {
  if (PRIOR_EXEC === undefined) delete process.env.BRAINBLAST_ORACLE_EXEC;
  else process.env.BRAINBLAST_ORACLE_EXEC = PRIOR_EXEC;
});

describe("keystone: a differential trap and the intake bottleneck", () => {
  it("is REJECTED by intake when Tier-2 is OFF — static alone cannot prove it", async () => {
    delete process.env.BRAINBLAST_ORACLE_EXEC; // default: static + compiler only
    const res = await ingestContribution({ submissionDir, rule: diffRule(), consentScope: "opt-in:train+eval" });
    expect(res.accepted).toBe(false);
    // The static engine abstains on a wrong-constant (UNKNOWN) → RED not reproduced.
    expect(res.proof.red).toBe(false);
  }, 60_000);

  it("the generalized prover DOES prove it RED→GREEN (light isolate, EXEC on) — the bottleneck is gone", async () => {
    // Proof the factory can now MANUFACTURE this class. context "local" uses the
    // light isolate, so this runs everywhere (no container needed) — it is the
    // capability the intake path was throwing away.
    process.env.BRAINBLAST_ORACLE_EXEC = "1";
    const { backends } = selectBackends("best");
    const result = await proveWithBest(
      backends,
      join(submissionDir, "vulnerable"),
      join(submissionDir, "fixed"),
      diffRule(),
      "local",
    );
    expect(result.proven?.method).toBe("differential");
  }, 60_000);

  // The full ingest path runs contributor code under context:"ingest" — the
  // HARDENED container, which refuses rather than falls back when no runtime
  // exists. So the end-to-end "accepted via ingest" assertion only runs where a
  // container runtime is available; elsewhere it is honestly skipped (the refuse
  // path itself is covered in oracle.tier2.test.ts).
  it.skipIf(!hasContainer)("is ACCEPTED by intake with method=differential under EXEC=1 + hardened sandbox", async () => {
    process.env.BRAINBLAST_ORACLE_EXEC = "1";
    const res = await ingestContribution({ submissionDir, rule: diffRule(), consentScope: "opt-in:train+eval" });
    expect(res.accepted).toBe(true);
    expect(res.method).toBe("differential");
    expect((res.vti as any)?.redGreenProof.method).toBe("differential");
    expect((res.vti as any)?.schemaVersion).toBe("1.1");
  }, 120_000);
});
