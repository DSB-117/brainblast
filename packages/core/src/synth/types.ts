import type { Severity } from "../types.ts";

// A Finding is the structured output of a research run. It is PURE DATA — the
// product of human/LLM research, not executable logic. Its sole job is to feed
// the synthesizer enough to (a) emit a YAML rule that binds to a vetted
// checker kind and (b) emit a vulnerable/fixed fixture pair the proof step
// can run RED->GREEN against.
//
// If `binding.check.kind` does not exist in the vetted checker registry, the
// Finding falls to the DRAFT queue for human review — the loop fails CLOSED.
export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  component: {
    name: string;
    type: string;
    version?: string;
    sourceUrl?: string;
  };
  detect: {
    modules: string[];
    nameRegex: string;
    triggerCalls: string[];
  };
  binding: {
    check: { kind: string; params: Record<string, any> };
    test: { kind: string; params?: Record<string, any> };
  };
  // Two small, self-contained code fixtures: one that the synthesized rule
  // MUST flag (vulnerable), one that it MUST clear (fixed). Provided as data
  // so we never auto-write fresh source code: a synthesis run only renders
  // strings the Finding already carried.
  fixtures: {
    filename: string; // e.g. "feeconfig.ts" — same name in both dirs
    vulnerable: string; // full file contents
    fixed: string; // full file contents
  };
  // Optional provenance — where this Finding came from. Surfaces in the draft
  // queue and the proven-rule commit, so humans can trace any committed
  // guardrail back to the source research note that motivated it.
  provenance?: {
    researchRun?: string;
    sourceUrl?: string;
    note?: string;
  };
}

export type SynthVerdict =
  | { kind: "proven"; ruleYaml: string; vulnerableDir: string; fixedDir: string; ruleId: string }
  | { kind: "draft"; reason: string; draftDir: string }
  | { kind: "failed"; reason: string; ruleId: string };
