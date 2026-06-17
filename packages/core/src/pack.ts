import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditWithRule } from "./audit.ts";
import { loadPack, PACK_MANIFEST_FILE } from "./packs.ts";
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
  /** "ok" | "missing-fixtures" | "red-failed" | "green-failed" */
  status: "ok" | "missing-fixtures" | "red-failed" | "green-failed";
  detail: string;
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

  const ok = ruleResults.every((r) => r.status === "ok" || r.status === "missing-fixtures");
  return { manifest, rules, ruleResults, ok };
}
