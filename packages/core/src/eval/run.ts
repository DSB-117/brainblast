// The runner — drives an adapter across the task set under each condition and
// aggregates a Scorecard.
//
// For every task we build a prompt, ask the model, grade the output with the
// pack's checker, and tally. In the `recall` condition the task's `recall` block
// (what `brainblast_recall` would surface) is prepended — so the delta between
// `bare` and `recall` is the corpus's measured lift on that model.

import { gradeCodeAsync } from "./grade.ts";
import { EVAL_TASKS } from "./tasks.ts";
import type {
  ConditionScore,
  EvalCondition,
  EvalTask,
  ModelAdapter,
  Scorecard,
  TaskOutcome,
} from "./types.ts";

// Instruction shared by both conditions. Kept fixed so the only variable between
// conditions is the recalled knowledge — a fair A/B.
export const SYSTEM_PREAMBLE =
  "You are a senior engineer writing production integration code. Implement exactly what is asked. " +
  "Output ONLY the code for a single self-contained file — no prose, no explanation, no Markdown fences. " +
  "Include the necessary imports.";

export function buildPrompt(task: EvalTask, condition: EvalCondition): string {
  const parts = [SYSTEM_PREAMBLE, ""];
  if (condition === "recall") {
    parts.push(
      "Before you write, a verified-trap knowledge base returned this for the SDK you are about to use. " +
        "Heed it:",
      task.recall,
      "",
    );
  }
  parts.push("Task:", task.prompt);
  return parts.join("\n");
}

function scoreCondition(condition: EvalCondition, outcomes: TaskOutcome[]): ConditionScore {
  const mine = outcomes.filter((o) => o.condition === condition);
  const green = mine.filter((o) => o.color === "GREEN").length;
  const red = mine.filter((o) => o.color === "RED").length;
  const unknown = mine.filter((o) => o.color === "UNKNOWN").length;
  const gradable = green + red;
  return {
    condition,
    total: mine.length,
    green,
    red,
    unknown,
    scorePct: gradable > 0 ? Math.round((green / gradable) * 1000) / 10 : null,
  };
}

export interface RunEvalOpts {
  adapter: ModelAdapter;
  /** Which conditions to run. Default: both (so lift is measured). */
  conditions?: EvalCondition[];
  /** Restrict to a subset of tasks (default: the full curated set). */
  tasks?: EvalTask[];
  /**
   * Allow the Tier-2 (executed/differential) oracle backends, which grade the
   * differential-io tasks by running the model's code against a golden table.
   * Defaults to true — running candidate code is the point of those tasks.
   */
  allowTier2?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

export async function runEval(opts: RunEvalOpts): Promise<Scorecard> {
  const tasks = opts.tasks ?? EVAL_TASKS;
  const conditions = opts.conditions ?? ["bare", "recall"];
  const allowTier2 = opts.allowTier2 ?? true;
  const now = opts.now ?? (() => new Date().toISOString());

  const outcomes: TaskOutcome[] = [];
  for (const condition of conditions) {
    for (const task of tasks) {
      let code = "";
      let color: TaskOutcome["color"] = "UNKNOWN";
      let detail = "";
      try {
        code = await opts.adapter.complete(buildPrompt(task, condition));
        const graded = await gradeCodeAsync(task.packId, code, { allowTier2 });
        color = graded.color;
        detail = graded.detail;
      } catch (e) {
        color = "UNKNOWN";
        detail = `adapter/grader error: ${(e as Error).message}`;
      }
      outcomes.push({
        taskId: task.id,
        packId: task.packId,
        sdk: task.sdk,
        trapClass: task.trapClass,
        severity: task.severity,
        condition,
        color,
        detail,
        code,
      });
    }
  }

  const conditionScores = conditions.map((c) => scoreCondition(c, outcomes));
  const bare = conditionScores.find((c) => c.condition === "bare");
  const recall = conditionScores.find((c) => c.condition === "recall");
  const lift =
    bare && recall
      ? {
          bareScorePct: bare.scorePct,
          recallScorePct: recall.scorePct,
          deltaPct:
            bare.scorePct !== null && recall.scorePct !== null
              ? Math.round((recall.scorePct - bare.scorePct) * 10) / 10
              : null,
        }
      : null;

  return {
    model: opts.adapter.name,
    capturedAt: now(),
    taskCount: tasks.length,
    conditions: conditionScores,
    lift,
    outcomes,
  };
}
