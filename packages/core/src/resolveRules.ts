import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadRules } from "./loadRules.ts";
import { loadPack, loadPacksFromDir } from "./packs.ts";
import { rules as bundled } from "../rules/index.ts";
import type { Rule } from "./types.ts";

// Bundled rules, plus any project-local rules in <targetDir>/.agent-research/rules/,
// plus any pluggable rule packs (third-party rule bundles identified by a
// brainblast-pack.yaml manifest — see src/packs.ts).
//
// Packs are loaded from two places:
//   - <targetDir>/.agent-research/packs/<pack-dir>/ (auto-discovered)
//   - `extraPackDirs` (e.g. from a `--packs <dir1>,<dir2>` CLI flag)
//
// Project rules and pack rules are how brainblast grows coverage WITHOUT an
// engine change: each rule is pure-data, validated, and binds only to
// vetted templates (no executable code is loaded). Neither a project rule
// nor a pack rule may shadow a bundled rule id (so a project/pack can't
// silently weaken a shipped CRITICAL) or another already-loaded rule;
// first one wins, later ones are dropped with a warning.
export function resolveRules(targetDir: string, extraPackDirs: string[] = []): Rule[] {
  const all: Rule[] = [...bundled];
  const seen = new Set(all.map((r) => r.id));

  const addRules = (rules: Rule[], sourceLabel: string) => {
    for (const r of rules) {
      if (seen.has(r.id)) {
        console.warn(`brainblast: rule '${r.id}' from ${sourceLabel} shadows an existing rule; keeping the first one loaded.`);
        continue;
      }
      all.push(r);
      seen.add(r.id);
    }
  };

  const projDir = join(targetDir, ".agent-research", "rules");
  if (existsSync(projDir)) {
    addRules(loadRules(projDir), "project rules");
  }

  for (const { manifest, rules } of loadPacksFromDir(join(targetDir, ".agent-research", "packs"))) {
    addRules(rules, `pack '${manifest.id}'`);
  }

  for (const dir of extraPackDirs) {
    const { manifest, rules } = loadPack(dir);
    addRules(rules, `pack '${manifest.id}' (${dir})`);
  }

  return all;
}
