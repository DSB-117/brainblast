// Public library API for @brainblast/core (the `.` export). The CLI bin is a
// thin front-end over this; the brainblast skill/agent path can import it too.

// ── Audit pipeline ────────────────────────────────────────────────────────────
export { audit, auditWithRule } from "./audit.ts";
export { resolveRules } from "./resolveRules.ts";
export { loadRules } from "./loadRules.ts";
export { rules as bundledRules } from "../rules/index.ts";
export { generateTestForResult } from "./generate.ts";
export { renderTest, testKinds } from "./testTemplates/index.ts";
export { runChecker, checkerKinds } from "./checkers/index.ts";
export { findCandidates } from "./finder.ts";
export { findConfigCandidates } from "./configFinder.ts";
export { getChangedRanges, fileChanged, rangeChanged, type ChangedRanges } from "./gitDiff.ts";

// ── Cost & Rent Analysis (Phase 3) ───────────────────────────────────────────
export { analyzeCosts, renderCostReportMd, rentExemptMinimum, lamportsToSol } from "./costAnalysis.ts";
export type { CostReport, AccountFlow, PriorityFeePosture, Recoverability } from "./costAnalysis.ts";

// ── Trust Graph (Phase 1) ─────────────────────────────────────────────────────
export {
  buildTrustGraph,
  renderTrustGraphMd,
  loadDirectory,
  isValidSolanaAddress,
  base58Encode,
  base58Decode,
  type BuildOpts,
} from "./trustGraph/index.ts";
export type {
  OnChainProgram,
  TrustGraph,
  UpgradeAuthority,
  UpgradeAuthorityKind,
  UpgradeAuthoritySource,
  VerifiedBuildState,
  AuditRef,
  ParityNote,
} from "./trustGraph/types.ts";

// ── Program Cache (Phase 4) ───────────────────────────────────────────────────
export {
  loadProgramCache,
  saveProgramCache,
  getCacheEntry,
  getCacheEntryMeta,
  putCacheEntry,
  cacheSize,
  defaultCachePath,
  isEntryExpired,
  DEFAULT_TTL_HOURS,
} from "./trustGraph/programCache.ts";
export type { ProgramCache, ProgramCacheEntry } from "./trustGraph/programCache.ts";

// ── Core types ────────────────────────────────────────────────────────────────
export type {
  Rule,
  CheckResult,
  CheckResultKind,
  CheckOutcome,
  Severity,
  Candidate,
  RustCandidate,
  RustAccountField,
  ConfigCandidate,
  Checker,
  RustChecker,
  ConfigChecker,
} from "./types.ts";
