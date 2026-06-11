import type { TestTemplate } from "../types.ts";

// No-op template for rules where a generated behavioral-contract test doesn't
// apply (e.g. config/env audits — there's no handler function to import and
// exercise). Satisfies `test.kind` validation without producing a misleading
// test file.
export const none: TestTemplate = (opts) => `// No behavioral contract test applies to this rule.
// Finding: ${opts.handlerExport} (${opts.handlerImportPath})
`;
