import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { checkerKinds } from "./checkers/index.ts";
import { testKinds } from "./testTemplates/index.ts";
import type { Rule, Severity } from "./types.ts";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

// Validate a loaded rule. This is the safety net for LLM-authored facts.yaml
// (T9): a malformed or mis-bound rule is rejected at load time, never silently
// run. Facts are data; the binding (check.kind/test.kind) must resolve to a
// human-vetted template that already exists in core.
function validateRule(r: any, file: string): void {
  const errs: string[] = [];
  if (!r || typeof r !== "object") {
    throw new Error(`invalid rule in ${file}: not a mapping`);
  }
  if (!r.id || typeof r.id !== "string") errs.push("missing id");
  if (!SEVERITIES.includes(r.severity)) errs.push(`bad severity '${r.severity}'`);
  if (!r.title || typeof r.title !== "string") errs.push("missing title");
  if (!r.component || !r.component.name || !r.component.type) errs.push("missing component.name/type");
  if (
    !r.detect ||
    !Array.isArray(r.detect.modules) ||
    typeof r.detect.nameRegex !== "string" ||
    !Array.isArray(r.detect.triggerCalls)
  ) {
    errs.push("detect must have modules[], nameRegex (string), triggerCalls[]");
  } else {
    try {
      new RegExp(r.detect.nameRegex);
    } catch {
      errs.push(`detect.nameRegex is not a valid regex: ${r.detect.nameRegex}`);
    }
  }
  if (!r.check || !checkerKinds.includes(r.check.kind)) {
    errs.push(`check.kind must be one of ${checkerKinds.join("|")} (got '${r.check?.kind}')`);
  }
  if (!r.test || !testKinds.includes(r.test.kind)) {
    errs.push(`test.kind must be one of ${testKinds.join("|")} (got '${r.test?.kind}')`);
  }
  if (errs.length) throw new Error(`invalid rule in ${file}: ${errs.join("; ")}`);
}

// Load every *.yaml rule from a directory. Rules are pure data (facts) that
// bind to vetted templates by kind — no executable code is loaded.
export function loadRules(dir: string): Rule[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const rules: Rule[] = [];
  for (const f of files) {
    const raw = parse(readFileSync(join(dir, f), "utf8"));
    validateRule(raw, f);
    rules.push(raw as Rule);
  }
  return rules;
}
