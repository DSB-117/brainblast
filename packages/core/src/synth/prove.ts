// The proof-as-classifier gate, factored out so BOTH the single-shot
// `synth-prove` CLI and the `fleet` orchestrator run the EXACT same RED→GREEN
// check — there is one gate, no second implementation to drift.
//
// No taste, no LLM: stage the Finding's rule + fixtures, run the existing engine,
// and let the audit's own colors decide. PROVEN only when the rule fails on the
// vulnerable fixture and passes on the fixed one, with exactly one check each.

import { join } from "node:path";
import { rmSync } from "node:fs";
import { audit } from "../audit.ts";
import { loadRules } from "../loadRules.ts";
import { checkerKinds } from "../checkers/index.ts";
import { testKinds } from "../testTemplates/index.ts";
import { stageFinding } from "./synthesize.ts";
import type { Finding } from "./types.ts";

export type ProveVerdict = "PROVEN" | "DRAFT";

export interface ProveOutcome {
  verdict: ProveVerdict;
  reason?: string; // why it DRAFTed (vetted-kind miss, load failure, wrong colors)
  redOk: boolean;
  greenOk: boolean;
  staged?: { ruleFile: string; vulnerableDir: string; fixedDir: string };
}

export function proveFinding(f: Finding, stageRoot: string): ProveOutcome {
  // Gate 1 — vetted kinds (cheapest; before staging anything).
  const unknownCheck = !checkerKinds.includes(f.binding.check.kind);
  const unknownTest = !testKinds.includes(f.binding.test.kind);
  if (unknownCheck || unknownTest) {
    const reason = [
      unknownCheck ? `check.kind '${f.binding.check.kind}' is not a vetted checker` : null,
      unknownTest ? `test.kind '${f.binding.test.kind}' is not a vetted test` : null,
    ]
      .filter(Boolean)
      .join("; ");
    return { verdict: "DRAFT", reason, redOk: false, greenOk: false };
  }

  // Stage rule + fixtures fresh.
  rmSync(join(stageRoot, f.id), { recursive: true, force: true });
  const staged = stageFinding(stageRoot, f);

  // Gate 2 — the staged rule must load (validates structure + kind binding).
  let rules;
  try {
    rules = loadRules(join(stageRoot, f.id, "rules"));
  } catch (e: any) {
    return { verdict: "DRAFT", reason: `staged rule failed loadRules: ${e?.message ?? e}`, redOk: false, greenOk: false, staged };
  }

  // Gate 3 — RED on vulnerable: exactly one check, this rule, fail.
  const vuln = audit(staged.vulnerableDir, rules);
  const redOk = vuln.checks.length === 1 && vuln.checks[0].ruleId === f.id && vuln.checks[0].result === "fail";

  // Gate 4 — GREEN on fixed: exactly one check, this rule, pass.
  const fixed = audit(staged.fixedDir, rules);
  const greenOk = fixed.checks.length === 1 && fixed.checks[0].ruleId === f.id && fixed.checks[0].result === "pass";

  if (redOk && greenOk) return { verdict: "PROVEN", redOk, greenOk, staged };

  return {
    verdict: "DRAFT",
    reason: `proof failed: vulnerable=${redOk ? "RED" : "wrong"}, fixed=${greenOk ? "GREEN" : "wrong"} — binding (check='${f.binding.check.kind}') is structurally unfit for this Finding`,
    redOk,
    greenOk,
    staged,
  };
}
