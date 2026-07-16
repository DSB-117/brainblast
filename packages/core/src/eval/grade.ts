// The grader — the credibility core of the eval.
//
// Grading reuses the exact deterministic checker that proves the VTI RED→GREEN:
// we write the model's output into a temp dir under the pack's own fixture
// filename, run the pack's single Rule through `auditWithRule`, and read the
// color off the CheckResult. RED = the checker found the footgun (the model fell
// in); GREEN = the checker ran and the footgun is absent (the model avoided it);
// UNKNOWN = the checker found no candidate to judge (off-task) or abstained.
//
// This is why the score has no secret answer key: the grader IS the published,
// re-runnable checker. Anyone can reproduce the same color on the same code.

import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPack } from "../packs.ts";
import { resolveBundledPackToken } from "../bundledPacks.ts";
import { auditWithRule } from "../audit.ts";
import type { Rule } from "../types.ts";
import type { EvalColor } from "./types.ts";

const EXT_BY_LANG: Record<string, string> = {
  typescript: "input.ts",
  rust: "lib.rs",
  go: "main.go",
  solidity: "Contract.sol",
  config: "config.txt",
};

export interface GradeResult {
  color: EvalColor;
  detail: string;
}

// Resolve a task's pack to its single grading Rule plus the fixture filename the
// model output should be written as (so the finder picks it up with the right
// language/path the rule expects).
export function loadTaskRule(packId: string): { rule: Rule; filename: string } {
  const dir = resolveBundledPackToken(packId);
  if (!dir) throw new Error(`eval: no bundled pack '${packId}'`);
  const { rules } = loadPack(dir);
  if (rules.length !== 1) {
    throw new Error(`eval: pack '${packId}' has ${rules.length} rules; eval tasks bind to single-rule packs`);
  }
  const rule = rules[0];
  const filename = fixtureFilename(dir, rule);
  return { rule, filename };
}

// Prefer the pack's real vulnerable-fixture filename (matters for config rules
// that key off the path); fall back to a language-appropriate default.
function fixtureFilename(packDir: string, rule: Rule): string {
  const base = join(packDir, "fixtures", rule.id, "vulnerable");
  if (existsSync(base)) {
    const files = readdirSync(base).filter((f) => !f.startsWith("."));
    if (files.length) return files[0];
  }
  return EXT_BY_LANG[rule.detect.lang ?? "typescript"] ?? "input.ts";
}

// Grade one model output for one pack. Deterministic and side-effect-free
// (writes only into a temp dir it then removes).
export function gradeCode(packId: string, code: string): GradeResult {
  const { rule, filename } = loadTaskRule(packId);
  const dir = mkdtempSync(join(tmpdir(), "bb-eval-"));
  try {
    const target = join(dir, filename);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, code, "utf8");
    const results = auditWithRule(dir, rule);
    const failed = results.find((r) => r.result === "fail");
    if (failed) return { color: "RED", detail: failed.detail };
    const passed = results.find((r) => r.result === "pass");
    if (passed) return { color: "GREEN", detail: passed.detail };
    return {
      color: "UNKNOWN",
      detail: results.length
        ? "checker abstained (cant_tell) — the footgun could not be decided statically"
        : "no matching integration found in the output — the model did not attempt the task",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
