// Scorecard rendering — a plain-text report and a stable JSON shape.

import type { Scorecard, TaskOutcome } from "./types.ts";

const COLOR_TAG: Record<TaskOutcome["color"], string> = {
  GREEN: "GREEN",
  RED: "RED  ",
  UNKNOWN: "UNK  ",
};

function pct(v: number | null): string {
  return v === null ? "  n/a" : `${v.toFixed(1)}%`;
}

export function renderScorecardText(sc: Scorecard, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`brainblast eval — score your model`);
  lines.push(`  model:  ${sc.model}`);
  lines.push(`  tasks:  ${sc.taskCount}  (verified footguns, checker-graded — no answer key)`);
  lines.push("");

  for (const c of sc.conditions) {
    const label = c.condition === "bare" ? "bare model     " : "with recall    ";
    lines.push(
      `  ${label}  avoided ${pct(c.scorePct)}   ` +
        `(GREEN ${c.green} · RED ${c.red} · UNK ${c.unknown} of ${c.total})`,
    );
  }

  if (sc.lift && sc.lift.deltaPct !== null) {
    const sign = sc.lift.deltaPct >= 0 ? "+" : "";
    lines.push("");
    lines.push(
      `  lift from recall:  ${sign}${sc.lift.deltaPct.toFixed(1)} pts  ` +
        `(${pct(sc.lift.bareScorePct)} → ${pct(sc.lift.recallScorePct)})`,
    );
  }

  if (opts.verbose) {
    lines.push("");
    lines.push("  per-task:");
    const conditions = [...new Set(sc.outcomes.map((o) => o.condition))];
    // group by task, show each condition side by side
    const byTask = new Map<string, TaskOutcome[]>();
    for (const o of sc.outcomes) {
      byTask.set(o.taskId, [...(byTask.get(o.taskId) ?? []), o]);
    }
    for (const [taskId, outs] of byTask) {
      const cells = conditions
        .map((cond) => {
          const o = outs.find((x) => x.condition === cond);
          return `${cond}=${o ? COLOR_TAG[o.color] : "  -  "}`;
        })
        .join("  ");
      const first = outs[0];
      lines.push(`    ${cells}  ${first.trapClass.padEnd(22)} ${taskId}`);
    }
  }

  return lines.join("\n");
}

export function scorecardJson(sc: Scorecard, opts: { includeCode?: boolean } = {}): string {
  const out = opts.includeCode
    ? sc
    : { ...sc, outcomes: sc.outcomes.map(({ code, ...rest }) => rest) };
  return JSON.stringify(out, null, 2);
}
