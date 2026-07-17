// Eval harness — public surface.
//
// "Score your model": measure whether a coding model ships the verified footguns
// the corpus catalogs, and how much recalling the matching VTI first closes the
// gap. Grading is the same deterministic checker that proves every VTI RED→GREEN
// — a reproducible number with no secret answer key.

export * from "./types.ts";
export { EVAL_TASKS } from "./tasks.ts";
export { gradeCode, gradeCodeAsync, loadTaskRule, ORACLE_CHECK_KINDS } from "./grade.ts";
export { staticAdapter, commandAdapter, httpAdapter, stripCodeFence } from "./adapters.ts";
export { runEval, buildPrompt, SYSTEM_PREAMBLE } from "./run.ts";
export { renderScorecardText, scorecardJson } from "./render.ts";
