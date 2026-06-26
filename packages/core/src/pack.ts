import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditWithRule } from "./audit.ts";
import { loadPack, PACK_MANIFEST_FILE } from "./packs.ts";
import { compilerBackend, verifyCompile } from "./oracle/backends/compiler.ts";
import type { OracleMethod } from "./oracle/types.ts";
import type { PackManifest, Rule } from "./types.ts";

export interface PackInitOptions {
  id: string;
  name?: string;
  author?: string;
  version?: string;
  description?: string;
}

// Scaffold a new rule pack at `dir`: a brainblast-pack.yaml manifest, an
// empty rules/ directory (for facts.yaml-style Rule definitions, same format
// as bundled/project rules), and an empty fixtures/ directory (each rule's
// `fixtures/<rule-id>/{vulnerable,fixed}/` pair is the "prove gate" consumed
// by `pack validate`).
export function initPack(dir: string, opts: PackInitOptions): string {
  if (existsSync(join(dir, PACK_MANIFEST_FILE))) {
    throw new Error(`${dir} already contains a ${PACK_MANIFEST_FILE}`);
  }

  const manifest: PackManifest = {
    id: opts.id,
    name: opts.name ?? opts.id,
    version: opts.version ?? "0.1.0",
    author: opts.author ?? "unknown",
    ...(opts.description ? { description: opts.description } : {}),
  };

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "rules"), { recursive: true });
  mkdirSync(join(dir, "fixtures"), { recursive: true });

  const manifestYaml = [
    `id: ${manifest.id}`,
    `name: ${manifest.name}`,
    `version: ${manifest.version}`,
    `author: ${manifest.author}`,
    ...(manifest.description ? [`description: ${manifest.description}`] : []),
    "",
  ].join("\n");
  const manifestFile = join(dir, PACK_MANIFEST_FILE);
  writeFileSync(manifestFile, manifestYaml, "utf8");

  return manifestFile;
}

export interface PackValidateResult {
  manifest: PackManifest;
  rules: Rule[];
  /** Per-rule prove-gate results. */
  ruleResults: PackRuleValidation[];
  /** True if the manifest is valid, every rule loaded cleanly, and every rule with fixtures passed RED->GREEN. */
  ok: boolean;
}

export interface PackRuleValidation {
  ruleId: string;
  /**
   * "ok"            — RED→GREEN proven
   * "missing-fixtures" — no fixtures to prove against (non-fatal)
   * "unverifiable"  — the oracle could not run here (e.g. the pinned SDK isn't
   *                   installed, so the compiler oracle abstained). Non-fatal:
   *                   a consumer who hasn't installed the SDK can't verify a
   *                   compiler-proven pack, but that's a missing tool, not a
   *                   broken record.
   * "red-failed"    — vulnerable fixture did not verify RED
   * "green-failed"  — fixed fixture did not verify GREEN
   */
  status: "ok" | "missing-fixtures" | "unverifiable" | "red-failed" | "green-failed";
  detail: string;
  /** Which oracle backend proved (or tried to prove) this rule's RED→GREEN. */
  method?: OracleMethod;
}

// Validate a rule pack at `dir`:
//   1. Manifest + rules load and validate (loadPack throws on failure).
//   2. For each rule with a fixtures/<rule-id>/{vulnerable,fixed} pair, prove
//      RED -> GREEN: the rule must FAIL against `vulnerable/` and must NOT
//      FAIL against `fixed/`. Rules without fixtures are reported as
//      "missing-fixtures" (a warning, not a hard failure) so a pack author
//      can still iterate before wiring up the prove gate.
export function validatePack(dir: string): PackValidateResult {
  const { manifest, rules } = loadPack(dir);

  const fixturesRoot = join(dir, "fixtures");
  const ruleResults: PackRuleValidation[] = rules.map((rule) => {
    const ruleFixturesDir = join(fixturesRoot, rule.id);
    const vulnerableDir = join(ruleFixturesDir, "vulnerable");
    const fixedDir = join(ruleFixturesDir, "fixed");

    if (!existsSync(vulnerableDir) || !existsSync(fixedDir)) {
      return {
        ruleId: rule.id,
        status: "missing-fixtures",
        detail: `no fixtures/${rule.id}/{vulnerable,fixed}/ directory — prove gate skipped`,
      };
    }

    // v0.9.0 — a rule whose verdict the STATIC engine cannot decide (e.g.
    // compiles-against-sdk) is proven by the Tier-1 compiler oracle instead:
    // offline, no execution, and SYNCHRONOUS (verifyCompile), so validatePack
    // keeps its sync signature. Every other rule keeps the exact static
    // RED→GREEN gate it had before v0.9.0 — the branch below is purely additive.
    if (compilerBackend.supports(rule)) {
      return validateCompilerRule(rule, vulnerableDir, fixedDir);
    }

    // v0.9.1 — Tier-2 rules (differential-io) EXECUTE candidate code, so they are
    // never run by the default offline `pack validate`. They're reported as
    // non-fatal "unverifiable" here; prove them with the explicit opt-in:
    //   brainblast verify <pack> --oracle=differential
    if (rule.check?.kind === "differential-io") {
      return {
        ruleId: rule.id,
        status: "unverifiable",
        method: "differential",
        detail:
          "Tier-2 differential rule — executes the candidate, so it is not run by the " +
          "default offline gate. Prove it with: brainblast verify <pack> --oracle=differential",
      };
    }

    const redChecks = auditWithRule(vulnerableDir, rule);
    const redFails = redChecks.filter((c) => c.result === "fail");
    if (redFails.length === 0) {
      return {
        ruleId: rule.id,
        status: "red-failed",
        detail: `expected at least one FAIL against fixtures/${rule.id}/vulnerable/, got none`,
      };
    }

    const greenChecks = auditWithRule(fixedDir, rule);
    const greenFails = greenChecks.filter((c) => c.result === "fail");
    if (greenFails.length > 0) {
      return {
        ruleId: rule.id,
        status: "green-failed",
        detail: `expected no FAIL against fixtures/${rule.id}/fixed/, got ${greenFails.length}`,
      };
    }

    return { ruleId: rule.id, status: "ok", detail: "RED -> GREEN proven" };
  });

  const ok = ruleResults.every(
    (r) => r.status === "ok" || r.status === "missing-fixtures" || r.status === "unverifiable",
  );
  return { manifest, rules, ruleResults, ok };
}

// Prove a compiler-oracle rule (compiles-against-sdk) RED→GREEN, synchronously.
// UNKNOWN on either side (most often: the pinned SDK isn't installed here) is a
// missing tool, not a broken record — reported non-fatally as "unverifiable".
function validateCompilerRule(rule: Rule, vulnerableDir: string, fixedDir: string): PackRuleValidation {
  const red = verifyCompile({ dir: vulnerableDir, rule });
  const green = verifyCompile({ dir: fixedDir, rule });
  if (red.color === "UNKNOWN" || green.color === "UNKNOWN") {
    return {
      ruleId: rule.id,
      status: "unverifiable",
      method: "compiler",
      detail: `compiler oracle could not verify here: ${red.color === "UNKNOWN" ? red.detail : green.detail}`,
    };
  }
  if (red.color !== "RED") {
    return { ruleId: rule.id, status: "red-failed", method: "compiler", detail: `compiler oracle expected RED on vulnerable/, got ${red.color}: ${red.detail}` };
  }
  if (green.color !== "GREEN") {
    return { ruleId: rule.id, status: "green-failed", method: "compiler", detail: `compiler oracle expected GREEN on fixed/, got ${green.color}: ${green.detail}` };
  }
  return { ruleId: rule.id, status: "ok", method: "compiler", detail: "RED -> GREEN proven (compiler)" };
}
