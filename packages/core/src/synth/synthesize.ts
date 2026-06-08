import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { Finding } from "./types.ts";

// Render a Finding into a YAML rule string. We deliberately go through `yaml`'s
// stringify rather than string-concat so escaping is correct and the resulting
// file round-trips cleanly through loadRules().
export function renderRuleYaml(f: Finding): string {
  const rule = {
    id: f.id,
    severity: f.severity,
    title: f.title,
    component: f.component,
    detect: f.detect,
    check: f.binding.check,
    test: f.binding.test,
  };
  const header =
    "# Auto-synthesized from a research Finding (proof-as-classifier loop).\n" +
    "# Pure data — every kind below resolves to a HUMAN-VETTED template in core.\n";
  return header + stringify(rule);
}

// Stage a Finding to disk: rule.yaml + matching vulnerable/fixed fixture dirs.
// Used for both the PROVE path (the orchestrator audits this staged layout)
// and the DRAFT path (the staged content is what a human reviews).
export function stageFinding(
  outRoot: string,
  f: Finding,
): { ruleFile: string; vulnerableDir: string; fixedDir: string; ruleYaml: string } {
  const stageDir = join(outRoot, f.id);
  const rulesDir = join(stageDir, "rules");
  const vulnerableDir = join(stageDir, "fixtures", "vulnerable");
  const fixedDir = join(stageDir, "fixtures", "fixed");
  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(vulnerableDir, { recursive: true });
  mkdirSync(fixedDir, { recursive: true });

  const ruleYaml = renderRuleYaml(f);
  const ruleFile = join(rulesDir, `${f.id}.yaml`);
  writeFileSync(ruleFile, ruleYaml, "utf8");
  writeFileSync(join(vulnerableDir, f.fixtures.filename), f.fixtures.vulnerable, "utf8");
  writeFileSync(join(fixedDir, f.fixtures.filename), f.fixtures.fixed, "utf8");

  return { ruleFile, vulnerableDir, fixedDir, ruleYaml };
}
