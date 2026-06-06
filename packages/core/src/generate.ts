import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { renderTest } from "./testTemplates/index.ts";
import type { CheckResult, Rule } from "./types.ts";

// Write the durable behavioral-contract test for a finding, using the rule's
// bound test template.
export function generateTestForResult(result: CheckResult, rule: Rule, outPath: string): string {
  const src = renderTest(rule.test.kind, {
    handlerImportPath: result.file,
    handlerExport: result.exportName,
    params: rule.test.params,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, src);
  return outPath;
}
