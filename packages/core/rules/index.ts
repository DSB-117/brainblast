import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "../src/loadRules.ts";

// Resolve the bundled rule-pack directory in a way that survives both layouts:
//  - dev (tsx, unbundled): the *.yaml live next to this file (packages/core/rules/)
//  - built (tsup): this module is bundled into dist/, and the build copies the
//    *.yaml into dist/rules/
function bundledRulesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  if (existsSync(join(here, "stripe-webhook-raw-body.yaml"))) return here;
  const sub = join(here, "rules");
  if (existsSync(join(sub, "stripe-webhook-raw-body.yaml"))) return sub;
  return here;
}

// The bundled rule pack, loaded from the *.yaml facts. The LLM researcher
// authors more (T9); the loader validates them. No executable code in a rule.
export const rules = loadRules(bundledRulesDir());
