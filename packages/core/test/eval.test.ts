import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { EVAL_TASKS } from "../src/eval/tasks.ts";
import { gradeCode, gradeCodeAsync, loadTaskRule, ORACLE_CHECK_KINDS } from "../src/eval/grade.ts";
import { runEval, buildPrompt } from "../src/eval/run.ts";
import { staticAdapter, stripCodeFence } from "../src/eval/adapters.ts";
import { resolveBundledPackToken } from "../src/bundledPacks.ts";
import { renderScorecardText, scorecardJson } from "../src/eval/render.ts";

function fixtureSource(packId: string, which: "vulnerable" | "fixed"): string {
  const dir = resolveBundledPackToken(packId)!;
  const { rule } = loadTaskRule(packId);
  const base = join(dir, "fixtures", rule.id, which);
  const file = readdirSync(base).filter((f) => !f.startsWith("."))[0];
  return readFileSync(join(base, file), "utf8");
}

// The tree-sitter grammars for Go/Solidity are native modules that may be absent
// in a minimal install. When they are, the CST-language tasks can't be graded
// here — the same reason the existing treeSitter.multilang test skips. We detect
// availability so the suite is green in either environment.
const _require = createRequire(import.meta.url);
function grammarAvailable(mod: string): boolean {
  try {
    _require.resolve(mod);
    return true;
  } catch {
    return false;
  }
}
const GRAMMAR_BY_LANG: Record<string, string> = { go: "tree-sitter-go", solidity: "tree-sitter-solidity" };
function taskGradable(packId: string): boolean {
  const { rule } = loadTaskRule(packId);
  const lang = rule.detect.lang ?? "typescript";
  const grammar = GRAMMAR_BY_LANG[lang];
  return !grammar || grammarAvailable(grammar);
}

describe("eval grader is the real checker (no answer key)", () => {
  // The credibility invariant: every curated task's pack must grade its OWN
  // proven fixtures correctly — vulnerable → RED, fixed → GREEN. This both proves
  // the grader is faithful and validates that each task is statically gradable.
  for (const task of EVAL_TASKS) {
    it.skipIf(!taskGradable(task.packId))(`${task.id}: vulnerable fixture grades RED, fixed grades GREEN`, async () => {
      const packDir = resolveBundledPackToken(task.packId);
      expect(packDir, `bundled pack '${task.packId}' must resolve`).toBeTruthy();

      // Oracle-graded kinds (differential / compiler) go through the async path;
      // static kinds through either. gradeCodeAsync dispatches correctly for both.
      const vuln = await gradeCodeAsync(task.packId, fixtureSource(task.packId, "vulnerable"));
      expect(vuln.color, `${task.id} vulnerable → ${vuln.detail}`).toBe("RED");

      const fixed = await gradeCodeAsync(task.packId, fixtureSource(task.packId, "fixed"));
      expect(fixed.color, `${task.id} fixed → ${fixed.detail}`).toBe("GREEN");
    });
  }

  it("oracle-graded tasks are present (differential + compiler classes)", () => {
    const oracleTasks = EVAL_TASKS.filter((t) => ORACLE_CHECK_KINDS.has(loadTaskRule(t.packId).rule.check.kind));
    expect(oracleTasks.length).toBeGreaterThanOrEqual(5);
  });
});

describe("grader edge cases", () => {
  it("off-task output grades UNKNOWN, not GREEN", () => {
    const r = gradeCode(EVAL_TASKS[0].packId, "export const nothing = 1;\n");
    expect(r.color).toBe("UNKNOWN");
  });
});

describe("prompt construction", () => {
  it("recall condition injects the recall block; bare does not", () => {
    const task = EVAL_TASKS[0];
    const bare = buildPrompt(task, "bare");
    const recall = buildPrompt(task, "recall");
    expect(bare).not.toContain(task.recall);
    expect(recall).toContain(task.recall);
    // Both share the same task instruction.
    expect(bare).toContain(task.prompt);
    expect(recall).toContain(task.prompt);
  });
});

describe("adapters", () => {
  it("stripCodeFence unwraps fenced code", () => {
    expect(stripCodeFence("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(stripCodeFence("const a = 1;")).toBe("const a = 1;");
  });

  it("stripCodeFence extracts a fenced block wrapped in prose", () => {
    // Models often ignore "no fences" and add commentary — grade the code, not the prose.
    const wrapped = "Here is the code:\n\n```typescript\nexport const a = 1;\n```\n\nHope that helps!";
    expect(stripCodeFence(wrapped)).toBe("export const a = 1;");
  });

  it("stripCodeFence picks the largest block when several are present", () => {
    const multi = "```bash\nnpm i\n```\nthen\n```ts\nexport function big() {\n  return 42;\n}\n```";
    expect(stripCodeFence(multi)).toContain("export function big()");
  });
});

describe("runEval end-to-end with a static adapter", () => {
  const now = () => "2026-07-16T00:00:00.000Z";

  it("a model that always returns the fixed code scores GREEN across the board", async () => {
    // Adapter keyed off which task the prompt is for (matches on the SDK phrasing
    // is brittle; instead we return the fixed fixture for the single task run).
    const task = EVAL_TASKS.find((t) => t.id === "jwt-verify-alg-none")!;
    const good = staticAdapter(() => fixtureSource(task.packId, "fixed"), "always-fixed");
    const sc = await runEval({ adapter: good, tasks: [task], now });
    const bare = sc.conditions.find((c) => c.condition === "bare")!;
    expect(bare.green).toBe(1);
    expect(bare.red).toBe(0);
    expect(bare.scorePct).toBe(100);
    expect(sc.model).toBe("always-fixed");
    // Render + JSON don't throw and include the model name.
    expect(renderScorecardText(sc)).toContain("always-fixed");
    expect(JSON.parse(scorecardJson(sc)).model).toBe("always-fixed");
  });

  it("a model that always returns the vulnerable code scores RED (0%)", async () => {
    const task = EVAL_TASKS.find((t) => t.id === "jwt-verify-alg-none")!;
    const bad = staticAdapter(() => fixtureSource(task.packId, "vulnerable"), "always-vuln");
    const sc = await runEval({ adapter: bad, tasks: [task], conditions: ["bare"], now });
    const bare = sc.conditions.find((c) => c.condition === "bare")!;
    expect(bare.red).toBe(1);
    expect(bare.scorePct).toBe(0);
  });

  it("measures lift when recall flips a vulnerable answer to a fixed one", async () => {
    const task = EVAL_TASKS.find((t) => t.id === "jwt-verify-alg-none")!;
    // Simulate a model that falls into the trap bare, but heeds the recall block.
    const conditional = staticAdapter(
      (prompt) => (prompt.includes(task.recall) ? fixtureSource(task.packId, "fixed") : fixtureSource(task.packId, "vulnerable")),
      "heeds-recall",
    );
    const sc = await runEval({ adapter: conditional, tasks: [task], now });
    expect(sc.lift).not.toBeNull();
    expect(sc.lift!.bareScorePct).toBe(0);
    expect(sc.lift!.recallScorePct).toBe(100);
    expect(sc.lift!.deltaPct).toBe(100);
  });
});
