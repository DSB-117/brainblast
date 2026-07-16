// Eval harness — shared types.
//
// "Score your model." A repeatable measurement of whether a coding model ships
// the silent, verified footguns the corpus catalogs — and how much recalling the
// matching VTI first (the `brainblast_recall` value proposition) closes the gap.
//
// The design invariant that makes the number credible: grading is done by the
// SAME deterministic checker engine that proves every VTI RED→GREEN (see
// grade.ts). There is no secret answer key — anyone can re-run the harness and
// the checker returns the same color on the same code.

export type EvalColor =
  // GREEN  — the model wrote the integration and AVOIDED the footgun.
  | "GREEN"
  // RED    — the model wrote the integration and FELL INTO the footgun.
  | "RED"
  // UNKNOWN — the checker could not decide: the model didn't attempt the
  //           integration (off-task), or the kind abstains statically.
  | "UNKNOWN";

// The two conditions we contrast. `bare` is the model alone; `recall` prepends
// exactly what `brainblast_recall` would surface for the task's SDK before the
// model writes a line. The delta between them is the corpus's measured lift.
export type EvalCondition = "bare" | "recall";

export interface EvalTask {
  /** Stable task id (kebab-case), also used as the deterministic ordering key. */
  id: string;
  /** Bundled pack that supplies the grader rule + fixture filename/lang. */
  packId: string;
  sdk: string;
  trapClass: string;
  severity: "critical" | "high" | "medium" | "low";
  /**
   * A realistic engineering instruction that naturally leads a naive model to
   * the footgun — WITHOUT naming the footgun or its fix (leak-free). This is the
   * hard part of a fair eval; these are hand-authored, not derived from the
   * record (a derived prompt leaks the answer via the fix detail).
   */
  prompt: string;
  /**
   * What `brainblast_recall` surfaces for this SDK/trap. Injected only in the
   * `recall` condition. This is the product, not cheating: the measurement is
   * "does knowing the proven footgun first change what the model writes?"
   */
  recall: string;
}

export interface ModelAdapter {
  /** Display name for the scorecard (e.g. "gpt-4o", "cmd:my-agent"). */
  name: string;
  /** Given a full prompt, return the model's raw code output for one file. */
  complete(prompt: string): Promise<string>;
}

export interface TaskOutcome {
  taskId: string;
  packId: string;
  sdk: string;
  trapClass: string;
  severity: EvalTask["severity"];
  condition: EvalCondition;
  color: EvalColor;
  /** The checker's own explanation for the color (verbatim receipt). */
  detail: string;
  /** The graded model output, kept for the receipt trail. */
  code: string;
}

export interface ConditionScore {
  condition: EvalCondition;
  total: number;
  green: number;
  red: number;
  unknown: number;
  /**
   * green / (green + red) as a percentage — the footgun-avoidance rate over the
   * tasks the checker could actually grade. UNKNOWN (off-task / abstain) is
   * excluded from the denominator so a model can't score by refusing to answer.
   */
  scorePct: number | null;
}

export interface Scorecard {
  model: string;
  capturedAt: string;
  taskCount: number;
  conditions: ConditionScore[];
  /** Present when both conditions ran: the measured lift from recall. */
  lift: { bareScorePct: number | null; recallScorePct: number | null; deltaPct: number | null } | null;
  outcomes: TaskOutcome[];
}
