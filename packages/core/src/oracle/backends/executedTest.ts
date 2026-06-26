import { writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { auditWithRule } from "../../audit.ts";
import { renderTest, testKinds } from "../../testTemplates/index.ts";
import { runInSandbox, makeSandboxDir, copyCandidate, packageRoot } from "../sandbox.ts";
import type { OracleBackend, OracleVerdict, OracleTarget } from "../types.ts";
import type { Rule } from "../../types.ts";

// Tier 2 — the BEHAVIORAL oracle: render the rule's VETTED contract test, run it
// against the candidate in the context-scaled sandbox; RED if the contract fails,
// GREEN if it passes. This converts "I audited a shape once" into "this behavior
// is wrong, provably, when executed" — catching errors with no nameable static
// shape (wrong return value, an exception under a specific input, state mutated
// incorrectly).
//
// This promotes the vitest runner that scripts/prove.ts already used as a
// build-time self-check into a first-class oracle backend, now isolated:
//   1. find the candidate (file + export) the contract binds to
//   2. render renderTest(rule.test.kind, …) — a VETTED template, never contributor logic
//   3. write candidate + test into an ephemeral sandbox dir
//   4. run the test runner inside the sandbox  → RED iff the contract test fails
//
// Default OFF: only runs when explicitly selected (--oracle=executed) or, under
// --oracle=best, when BRAINBLAST_ORACLE_EXEC=1. The default `npx brainblast`
// executes no candidate code.
//
// Honesty guard: an executed-test RED only counts when the test is a VETTED
// template bound by test.kind. A contributed *fixture* is fine; a contributed
// *oracle* (arbitrary test script) is NOT — that would re-open the "LLM-authored
// checker" hole the architecture deliberately closed.

function supports(rule: Rule): boolean {
  const kind = rule.test?.kind;
  return !!kind && kind !== "none" && testKinds.includes(kind);
}

// A minimal vitest config that includes the generated contract test in the
// ephemeral dir (the package's own config scopes to test/** and would exclude it).
const SBX_VITEST_CONFIG = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["**/*.contract.test.ts"], watch: false } });
`;

export const executedTestBackend: OracleBackend = {
  method: "executed-test",
  tier: 2,
  supports,
  async verify({ dir, rule, context = "local" }: OracleTarget): Promise<OracleVerdict> {
    const t0 = Date.now();
    if (!supports(rule)) {
      return unknown(`rule '${rule.id}' has no vetted test.kind to execute`, t0);
    }
    // Bind the contract to the candidate the rule detects in this fixture.
    const candidate = auditWithRule(dir, rule)[0];
    if (!candidate) {
      return unknown(`no candidate detected in ${dir} to bind the '${rule.test.kind}' contract to`, t0);
    }

    const sandbox = makeSandboxDir(".oracle-exec-");
    try {
      const copied = copyCandidate(dir, sandbox);
      if (copied.length === 0) return unknown(`no candidate files under ${dir}`, t0);

      // The candidate file, copied into the sandbox, addressed relative to it.
      const candidateRel = relative(dir, candidate.file);
      const importPath = "./" + candidateRel.replace(/\.(ts|tsx|mts|cts)$/, "");

      let testSrc: string;
      try {
        testSrc = renderTest(rule.test.kind, {
          handlerImportPath: importPath,
          handlerExport: candidate.exportName,
          params: rule.test.params,
        });
      } catch (e: any) {
        return unknown(`could not render the '${rule.test.kind}' contract: ${e?.message ?? e}`, t0);
      }
      writeFileSync(join(sandbox, "brainblast.contract.test.ts"), testSrc);
      writeFileSync(join(sandbox, "vitest.sbx.config.ts"), SBX_VITEST_CONFIG);

      const res = runInSandbox({
        dir: sandbox,
        command: "npx",
        args: ["vitest", "run", "--config", "vitest.sbx.config.ts", "--no-color", "brainblast.contract.test.ts"],
        context,
        timeoutMs: 90_000, // vitest cold start + the contract
        readonlyMounts: [join(packageRoot(), "node_modules")],
      });

      if (res.status === "refused") {
        return { color: "UNKNOWN", method: "executed-test", detail: res.detail ?? "ingest sandbox refused", durationMs: Date.now() - t0 };
      }
      if (res.status !== "ok") {
        return { color: "UNKNOWN", method: "executed-test", detail: `contract did not run cleanly (${res.status}): ${res.detail ?? res.stderr.split("\n")[0]}`, durationMs: Date.now() - t0 };
      }
      // vitest exit 0 = contract PASSED → trap avoided (GREEN); non-zero = FAILED → trap present (RED).
      if (res.exitCode === 0) {
        return { color: "GREEN", method: "executed-test", detail: `the '${rule.test.kind}' contract passed when executed.`, evidence: { test: rule.test.kind, runner: "vitest", isolation: res.isolation }, durationMs: Date.now() - t0 };
      }
      return {
        color: "RED",
        method: "executed-test",
        detail: `the '${rule.test.kind}' contract FAILED when executed against the candidate.`,
        evidence: { test: rule.test.kind, runner: "vitest", isolation: res.isolation, exitCode: res.exitCode },
        durationMs: Date.now() - t0,
      };
    } catch (e: any) {
      return unknown(`executed-test oracle could not run: ${e?.message ?? String(e)}`, t0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  },
};

function unknown(detail: string, t0: number): OracleVerdict {
  return { color: "UNKNOWN", method: "executed-test", detail, durationMs: Date.now() - t0 };
}
