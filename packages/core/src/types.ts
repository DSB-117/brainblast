import type { FunctionDeclaration, ArrowFunction } from "ts-morph";

export type Severity = "critical" | "high" | "medium" | "low";
export type CheckResultKind = "pass" | "fail" | "cant_tell";

export interface Candidate {
  filePath: string;
  fnName: string;
  params: string[];
  fn: FunctionDeclaration | ArrowFunction;
}

export interface CheckOutcome {
  result: CheckResultKind;
  detail: string;
}

export interface CheckResult extends CheckOutcome {
  ruleId: string;
  severity: Severity;
  title: string;
  file: string;
  line: number;
  exportName: string;
}

// A Rule is PURE DATA — LLM-authorable as facts.yaml. It carries no executable
// code; `check.kind` and `test.kind` bind to human-vetted templates in core.
// This is the seam from the eng review (D8 / Codex tension 3): facts + vetted
// templates, never LLM-authored checker functions.
export interface Rule {
  id: string;
  severity: Severity;
  title: string;
  component: { name: string; type: string; version?: string; sourceUrl?: string };
  detect: { modules: string[]; nameRegex: string; triggerCalls: string[] };
  check: { kind: string; params: Record<string, any> };
  test: { kind: string; params?: Record<string, any> };
}

export type Checker = (candidate: Candidate, params: any) => CheckOutcome;
export type TestTemplate = (opts: {
  handlerImportPath: string;
  handlerExport: string;
  params?: any;
}) => string;
