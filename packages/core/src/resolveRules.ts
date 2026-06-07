import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadRules } from "./loadRules.ts";
import { rules as bundled } from "../rules/index.ts";
import type { Rule } from "./types.ts";

// Bundled rules plus any project-local rules in <targetDir>/.agent-research/rules/.
// Project rules are how the LLM researcher (T9) grows coverage WITHOUT an engine
// change: it authors a facts.yaml there, the loader validates it, and it binds
// only to vetted templates (no executable code is loaded). A project rule may
// not shadow a bundled rule id (so a project can't silently weaken a shipped
// CRITICAL); it can only add new ones.
export function resolveRules(targetDir: string): Rule[] {
  const all: Rule[] = [...bundled];
  const projDir = join(targetDir, ".agent-research", "rules");
  if (existsSync(projDir)) {
    const seen = new Set(all.map((r) => r.id));
    for (const r of loadRules(projDir)) {
      if (seen.has(r.id)) {
        console.warn(`brainblast: project rule '${r.id}' shadows a bundled rule; keeping bundled.`);
        continue;
      }
      all.push(r);
      seen.add(r.id);
    }
  }
  return all;
}
