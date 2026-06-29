// The distribution surface — the lean subpath export (`brainblast/distribution`).
//
// A host like the registry server (registry.brainblast.tech) needs only the
// corpus/feed/marketplace/server logic, NOT the auditor's heavy deps (tree-sitter,
// ts-morph, @solana/web3.js). Importing the package ROOT would drag those into a
// serverless bundle; this entry re-exports ONLY the pure data-market modules,
// whose sole runtime dependency is node:crypto. Keep it that way.

export {
  handleRequest,
  type ServerRequest,
  type ServerResponse,
  type ServerDeps,
  type ServerLot,
} from "./server.ts";

export {
  buildCatalog,
  renderCatalogMd,
  issueGrant,
  verifyGrant,
  generateDistributorKeypair,
  addressFromSecretKey,
  appendUsage,
  verifyLedger,
  summarizeUsage,
  canonicalJson,
  TIER_PRICING,
  LEDGER_GENESIS,
  type CatalogResult,
  type CatalogOptions,
  type TierPricing,
  type Grant,
  type GrantPayload,
  type GrantAlg,
  type GrantSigner,
  type GrantVerifier,
  type GrantVerification,
  type DistributorKeypair,
  type IssueGrantArgs,
  type UsageRecord,
  type UsageEntry,
  type BuyerUsage,
} from "./marketplace.ts";

export {
  selectFeed,
  tierForBrain,
  TIER_ENTITLEMENTS,
  TIER_BRAIN_THRESHOLDS,
  type FeedTier,
  type FeedQuery,
  type FeedResult,
  type FeedRecord,
  type FeedReceipt,
  type TierEntitlement,
} from "./feed.ts";

export { scoreVti, dedupKey, buildCorpusIndex, type CorpusVti, type ScoredVti, type CorpusIndex } from "./corpus.ts";
export { TRAP_CLASSES, classifyTrap, CLASS_BY_RULE, type TrapClass } from "./vtiClass.ts";
export { base58Encode, base58Decode } from "./base58.ts";
