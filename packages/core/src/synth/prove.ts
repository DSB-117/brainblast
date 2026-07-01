// The proof-as-classifier gate, factored out so BOTH the single-shot
// `synth-prove` CLI and the `fleet` orchestrator run the EXACT same RED→GREEN
// check — there is one gate, no second implementation to drift.
//
// No taste, no LLM: stage the Finding's rule + fixtures and let the engine's own
// colors decide. PROVEN only when the rule goes RED on the vulnerable fixture and
// GREEN on the fixed one.
//
// The proof is run through the GENERALIZED ORACLE (`proveWithBest`), not just the
// static checker: whichever backend the rule's `check.kind` selects proves it —
// `static` for shape checks, `compiler` for compiles-against-sdk (hallucinated/
// moved APIs, no shape needed), `executed`/`differential` for behavioral golden-
// I/O (semantic, and the multi-language path via the sandbox). Each backend
// self-gates on `supports(rule)`, so a static-shape finding still proves purely
// statically — no code execution unless the finding deliberately binds a
// behavioral kind.

import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadRules } from "../loadRules.ts";
import { checkerKinds } from "../checkers/index.ts";
import { testKinds } from "../testTemplates/index.ts";
import { ALL_BACKENDS, proveWithBest, proofMethod } from "../oracle/index.ts";
import { stageFinding } from "./synthesize.ts";
import type { Finding } from "./types.ts";

export type ProveVerdict = "PROVEN" | "DRAFT";

export interface ProveOutcome {
  verdict: ProveVerdict;
  reason?: string; // why it DRAFTed (vetted-kind miss, load failure, wrong colors)
  redOk: boolean;
  greenOk: boolean;
  method?: string | null; // the strongest proof method (static-checker | compiler | executed | differential | compound)
  corroborations?: string[]; // other backends that also proved it (confidence/price signal)
  staged?: { ruleFile: string; vulnerableDir: string; fixedDir: string };
}

// `context` mirrors the oracle's isolation model: "local" (light isolate for our
// own authored fixtures) vs "ingest" (hardened container that refuses to fall
// back). The fleet/synth run authored fixtures locally.
export async function proveFinding(
  f: Finding,
  stageRoot: string,
  context: "local" | "ingest" = "local",
): Promise<ProveOutcome> {
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
  const rule = rules.find((r) => r.id === f.id) ?? rules[0];
  if (!rule) {
    return { verdict: "DRAFT", reason: "no rule loaded from the staged Finding", redOk: false, greenOk: false, staged };
  }

  // Gate 3+4 — RED→GREEN via the generalized oracle. The eligible backend is
  // chosen by the rule (static → compiler → executed → differential); the first
  // that proves RED→GREEN wins, others corroborate.
  const result = await proveWithBest(ALL_BACKENDS, staged.vulnerableDir, staged.fixedDir, rule, context);

  if (result.proven) {
    return {
      verdict: "PROVEN",
      redOk: true,
      greenOk: true,
      method: proofMethod(result) as string,
      corroborations: result.corroborations,
      staged,
    };
  }

  // DRAFT — surface how far each attempted backend got (for the scoreboard).
  const first = result.attempts[0];
  const redOk = result.attempts.some((a) => a.red);
  const greenOk = result.attempts.some((a) => a.green);
  const tried = result.attempts.length
    ? result.attempts.map((a) => `${a.method}(red=${a.red},green=${a.green})`).join(", ")
    : "no eligible backend for this check.kind";
  return {
    verdict: "DRAFT",
    reason: `proof failed [${tried}] — the binding (check='${f.binding.check.kind}') is unfit for this Finding, or its oracle (compiler SDK / sandbox) was unavailable`,
    redOk: first ? redOk : false,
    greenOk: first ? greenOk : false,
    staged,
  };
}
