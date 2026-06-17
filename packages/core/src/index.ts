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
export { getChangedRanges, getWorkingTreeChanges, fileChanged, rangeChanged, type ChangedRanges } from "./gitDiff.ts";
export { startWatch, runIncrementalScan, type WatchEvent, type WatchOptions } from "./watch.ts";
export { applyDiffToFile, parseDiff, type ParsedDiff } from "./fixers/applyDiff.ts";
export { loadPack, loadPacksFromDir, validatePackManifest, PACK_MANIFEST_FILE } from "./packs.ts";
export { initPack, validatePack, type PackInitOptions, type PackValidateResult, type PackRuleValidation } from "./pack.ts";
export {
  isTelemetryEnabled,
  getUserHash,
  getRepoHash,
  telemetryFilePath,
  recordGraduationEvents,
  submitTelemetry,
  DEFAULT_REGISTRY_URL,
  type GraduationEvent,
  type TelemetrySubmitResult,
} from "./telemetry.ts";

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

// ── OSV advisory client (v0.6.0) ─────────────────────────────────────────────
export { queryOsv, type OsvAdvisory } from "./osv.ts";

// ── Upgrade risk diff (v0.6.0) ────────────────────────────────────────────────
export { diffVersions, riskScore, renderDiffText, renderDiffMd, type DiffResult } from "./diff.ts";

// ── Drift alerting (v0.6.1) ───────────────────────────────────────────────────
export {
  checkDrift,
  seedPackages,
  renderDriftText,
  type DriftPackage,
  type DriftAdvisory,
  type DriftBaseline,
  type DriftResult,
} from "./drift.ts";

// ── Token identity + quality (v0.6.4) ────────────────────────────────────────
export { CANONICAL_MINTS, CANONICAL_BY_MINT, canonicalMintForSymbol, isCanonicalMint, type CanonicalMint } from "./solanaCanonicalMints.ts";
export { verifyTokenIdentity, type TokenIdentity, type IdentityStatus, type VerifyOpts } from "./tokenRegistry.ts";
export { analyzeToken, renderRicoText, deployerFlagsFrom, type RicoResult, type RicoOutcome, type RicoTokenSecurity } from "./ricomaps.ts";

// ── AI-agent transaction firewall (v0.7.0) ────────────────────────────────────
export {
  inspectTransaction,
  decodeTransaction,
  analyzeInstructions,
  parseCpiPrograms,
  renderFirewallText,
  KNOWN_PROGRAMS,
  type FirewallReport,
  type FirewallFinding,
  type FirewallVerdict,
  type FirewallSeverity,
  type FirewallProgram,
  type FirewallOpts,
  type DecodedTx,
  type DecodedInstruction,
} from "./firewall.ts";

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
  PackManifest,
} from "./types.ts";
