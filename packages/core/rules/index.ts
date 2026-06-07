import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "../src/loadRules.ts";

// The bundled rule pack, loaded from the *.yaml facts in this directory. The
// LLM researcher authors more of these (T9); the loader validates them. No
// executable code lives in a rule — only facts that bind to vetted templates.
export const rules = loadRules(dirname(fileURLToPath(import.meta.url)));
