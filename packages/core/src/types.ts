import type { FunctionDeclaration, ArrowFunction } from "ts-morph";

export type Severity = "critical" | "high" | "medium" | "low";
export type CheckResultKind = "pass" | "fail" | "cant_tell";

// TypeScript/JavaScript candidate (ts-morph based).
export interface Candidate {
  filePath: string;
  fnName: string;
  params: string[];
  fn: FunctionDeclaration | ArrowFunction;
}

// A single Anchor account field with its parsed attribute data.
export interface RustAccountField {
  /** Rust field identifier, e.g. "counter" */
  name: string;
  /** Raw type text, e.g. "Account<'info, Counter>", "Signer<'info>" */
  typeName: string;
  /** Full text of every #[account(...)] attribute on this field */
  attrText: string;
  /** Whether init_if_needed is present in attrText */
  hasInitIfNeeded: boolean;
}

// Rust/Anchor candidate (tree-sitter based).
// Created by rustFinder.ts; consumed by Anchor checker kinds.
export interface RustCandidate {
  /** Source .rs file */
  filePath: string;
  /** Instruction handler name, e.g. "initialize" */
  fnName: string;
  /** Anchor Accounts struct name resolved from Context<X>, e.g. "Initialize" */
  accountStructName: string;
  /** All fields extracted from the Accounts struct */
  accountFields: RustAccountField[];
  /**
   * Raw text of the instruction handler body block `{ ... }` — used by
   * checkers that need to inspect companion calls (require!, data_is_empty, etc.)
   * without a full tree-sitter traversal.
   */
  fnBodyText: string;
  /** tree-sitter SyntaxNode for the function body — available for precise queries */
  fnBodyNode: any;
}

// Config/env candidate — a whole file matched by `detect.filePatterns`
// (e.g. `.env`, `next.config.js`, `vercel.json`). Unlike Candidate/RustCandidate
// these aren't function-scoped: the "finding" is about the file as a whole.
export interface ConfigCandidate {
  /** Source file (absolute path) */
  filePath: string;
  /** Raw file contents */
  content: string;
  /** Whether this file is tracked by git / not covered by .gitignore */
  tracked: boolean;
}

export interface CheckOutcome {
  result: CheckResultKind;
  detail: string;
}

// Fix-it mode: an actionable remediation for a "fail" CheckOutcome.
//
// `diff` (when present) is a unified diff hunk for a single file that an
// agent can apply directly (e.g. via `git apply` or by locating the `-`/`+`
// lines and editing in place) to mechanically resolve the finding.
//
// `suggestion` (when present, usually instead of `diff`) is human/agent
// readable guidance for findings that require structural changes brainblast
// cannot safely synthesize (e.g. adding a missing verification call from
// scratch). Both may be present if a partial mechanical fix still leaves
// follow-up work.
export interface Fix {
  summary: string;
  diff?: string;
  suggestion?: string;
}

// Living memory: a prior fix of the same rule, recorded in a different file
// during an earlier run (see memory.ts). Lets brainblast say "you fixed this
// exact issue in <file> on <fixedAt> — this file has the same gap."
export interface Precedent {
  file: string;
  exportName: string;
  fixedAt: string;
  detail: string;
}

export interface CheckResult extends CheckOutcome {
  ruleId: string;
  severity: Severity;
  title: string;
  file: string;
  line: number;
  exportName: string;
  /** Present when result === "fail" and a vetted fixer for check.kind produced one. */
  fix?: Fix;
  /** Present when result === "fail" and the same rule was previously fixed elsewhere. */
  precedent?: Precedent;
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
  detect: {
    modules: string[];
    nameRegex: string;
    triggerCalls: string[];
    /**
     * Defaults to "typescript". Set to "rust" for Anchor/Rust checker kinds,
     * or "config" for whole-file config/env audits (see `filePatterns`).
     */
    lang?: "typescript" | "rust" | "config";
    /**
     * Required when `lang: "config"`. Regexes (matched against the file path
     * relative to the scan root) selecting which files this rule audits,
     * e.g. `["(^|/)\\.env(\\.[^/]+)?$"]`. Ignored for "typescript"/"rust".
     */
    filePatterns?: string[];
    /**
     * When true, a module import from `modules` is a REQUIRED condition for
     * detection: a candidate must be in a file that imports one of the listed
     * modules, AND either its name matches nameRegex or its body calls a
     * triggerCall.  This prevents generic name-only matches (e.g. a Fastify
     * middleware named "verifyJwt" that calls `request.jwtVerify()`) from
     * triggering jose-specific rules.
     *
     * When false or omitted (default), detection is: nameRegex match OR
     * triggerCall in body.  Module import is not required, so rules like
     * stripe-webhook can still catch handlers that don't import stripe directly.
     */
    requiresImport?: boolean;
  };
  check: { kind: string; params: Record<string, any> };
  test: { kind: string; params?: Record<string, any> };
  /**
   * Exploit Pattern Database provenance (v0.7.3): links this rule to the real
   * on-chain incident whose root cause it detects. Optional; present on rules
   * derived from a public post-mortem. The authoritative, user-facing catalog
   * lives in src/exploitPatterns.ts — this inline block is rule-local
   * provenance and is cross-checked against the catalog in tests.
   */
  exploit?: {
    incident: string;
    date: string;
    lossUsd?: number;
    chain?: string;
    postmortemUrl: string;
    pattern?: string;
  };
  /**
   * Provenance for rules loaded from a third-party rule pack (see
   * src/packs.ts). Absent for bundled rules. Stamped by the pack loader from
   * the pack's brainblast-pack.yaml manifest, not set by the rule author.
   */
  pack?: { id: string; version: string; author?: string };
}

// A rule pack: a bundle of rules + fixtures distributed independently of
// @brainblast/core, identified by `brainblast-pack.yaml` at its root.
export interface PackManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
}

export type Checker = (candidate: Candidate, params: any) => CheckOutcome;
export type RustChecker = (candidate: RustCandidate, params: any) => CheckOutcome;
export type ConfigChecker = (candidate: ConfigCandidate, params: any) => CheckOutcome;
// Fix-it mode: human-vetted fixer template, bound to the same `check.kind` as
// its checker counterpart. Receives the same candidate/params plus the
// checker's "fail" outcome, and returns a Fix or undefined if no vetted
// remediation applies to this particular fail detail.
export type Fixer = (candidate: Candidate, params: any, outcome: CheckOutcome) => Fix | undefined;
export type TestTemplate = (opts: {
  handlerImportPath: string;
  handlerExport: string;
  params?: any;
}) => string;
