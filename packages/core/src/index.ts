// Public library API for @brainblast/core (the `.` export). The CLI bin is a
// thin front-end over this; the brainblast skill/agent path can import it too.
export { audit, auditWithRule } from "./audit.ts";
export { resolveRules } from "./resolveRules.ts";
export { loadRules } from "./loadRules.ts";
export { rules as bundledRules } from "../rules/index.ts";
export { generateTestForResult } from "./generate.ts";
export { renderTest, testKinds } from "./testTemplates/index.ts";
export { runChecker, checkerKinds } from "./checkers/index.ts";
export { findCandidates } from "./finder.ts";
export type {
  Rule,
  CheckResult,
  CheckResultKind,
  CheckOutcome,
  Severity,
  Candidate,
} from "./types.ts";
