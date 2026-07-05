// The VTI feed — Stage 4 of ROADMAP-TRAINING-DATA.md.
//
// Not a dataset dump: a *subscription to the delta*. A consumer streams the
// newly-verified / newly-corroborated VTIs that match their stack, each one
// carrying its RED→GREEN reproducibility receipt, and resumes from a cursor next
// time. This is the product surface a lab plugs into its own eval/training loop.
//
// Pure: filter + tier + receipt logic only. The CLI (runFeed) does the lot
// reading and NDJSON emission; the on-chain $BRAIN tier check lives in the
// wallet layer. Keeping this pure makes the access model fully unit-testable.

import { scoreVti, type CorpusVti } from "./corpus.ts";
import type { TrapClass } from "./vtiClass.ts";

export type FeedTier = "sample" | "standard" | "firehose";

export interface TierEntitlement {
  tier: FeedTier;
  maxRecords: number | null; // null = unlimited
  includeFixtures: boolean; // the trainable payload (vulnerable/fixed/test)
  // Sample (the free teaser) holds back the newest delta by this many hours so
  // the paid product isn't given away. Paid access has NO holdback: the moat is
  // breadth (which curated lots) + all future lots, not a time delay.
  freshnessHoldbackHours: number;
}

// The access ladder. `sample` is the open teaser: metadata + the RED→GREEN
// receipt (proof we have it), but NOT the fixtures (the trainable code) and with
// a freshness holdback. Paid access is lot-scoped (à-la-carte via the grant's
// `lots`): `standard` = one or more curated lots; `firehose` = Scale (every lot
// + all future lots). Both paid tiers get full fixtures, 0 holdback, and every
// record IN SCOPE — the product axis is which lots the grant names, not volume
// or freshness. (Enum ids are kept stable for the published CLI; `firehose` is
// surfaced to buyers as "Scale".)
export const TIER_ENTITLEMENTS: Record<FeedTier, TierEntitlement> = {
  sample: { tier: "sample", maxRecords: 5, includeFixtures: false, freshnessHoldbackHours: 168 },
  standard: { tier: "standard", maxRecords: null, includeFixtures: true, freshnessHoldbackHours: 0 },
  firehose: { tier: "firehose", maxRecords: null, includeFixtures: true, freshnessHoldbackHours: 0 },
};

// $BRAIN held → tier. Thresholds are tunable (and, like the wallet caps, are not
// price-calibrated without a feed); documented so the access model is legible.
// NOTE: this computes what a wallet QUALIFIES for. It is advisory/client-side —
// real entitlement (which lots a buyer receives) is enforced server-side at
// distribution. See the honesty note in WALLET-PLAN.md / the feed docs.
export const TIER_BRAIN_THRESHOLDS: { tier: FeedTier; minBrain: number }[] = [
  { tier: "firehose", minBrain: 1_000_000 },
  { tier: "standard", minBrain: 100_000 },
  { tier: "sample", minBrain: 0 },
];

export function tierForBrain(brainHeld: number): FeedTier {
  for (const t of TIER_BRAIN_THRESHOLDS) {
    if (brainHeld >= t.minBrain) return t.tier;
  }
  return "sample";
}

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface FeedQuery {
  sdk?: string; // case-insensitive substring match on the SDK name
  class?: TrapClass;
  minSeverity?: "critical" | "high" | "medium" | "low"; // this level AND above
  minCorroboration?: number;
  since?: string; // ISO cursor: only records with capturedAt strictly after this
  limit?: number; // consumer-requested cap (further bounded by the tier)
  now?: string; // injectable "current time" for deterministic freshness tests
}

// The RED→GREEN reproducibility receipt that ships with every record — the
// credibility feature scraped data can't offer.
export interface FeedReceipt {
  red: boolean;
  green: boolean;
  method?: string;
  verifiedAt?: string;
}

export interface FeedRecord {
  trapId: string;
  title?: string;
  sdk: { name: string; version?: string | null };
  severity: string;
  class: TrapClass;
  score: number;
  corroborationCount: number;
  license: string;
  capturedAt?: string;
  sourceUrls: string[];
  receipt: FeedReceipt; // always present — the proof
  // Present only on paid tiers (the trainable payload).
  fixtures?: {
    vulnerable?: { snippet?: string; lang?: string };
    fixed?: { snippet?: string; lang?: string };
    generatedTest?: unknown;
  };
}

export interface FeedResult {
  tier: FeedTier;
  entitlement: TierEntitlement;
  records: FeedRecord[];
  cursor: string | null; // max capturedAt emitted — pass as `since` to resume
  counts: {
    matchedQuery: number; // records matching the query (before tier limits)
    heldBackFreshness: number; // matched but withheld as too-fresh for this tier
    emitted: number; // actually streamed
    capped: number; // dropped because the tier/limit cap was hit
  };
}

function proven(v: CorpusVti): boolean {
  return v.redGreenProof?.red === true && v.redGreenProof?.green === true;
}

function matchesQuery(v: CorpusVti, q: FeedQuery): boolean {
  if (q.sdk && !(v.sdk?.name ?? "").toLowerCase().includes(q.sdk.toLowerCase())) return false;
  if (q.class && v.class !== q.class) return false;
  if (q.minSeverity && (SEVERITY_ORDER[v.severity] ?? 0) < SEVERITY_ORDER[q.minSeverity]) return false;
  if (q.minCorroboration != null && (v.corroborationCount ?? 0) < q.minCorroboration) return false;
  if (q.since && !(typeof v.capturedAt === "string" && v.capturedAt > q.since)) return false;
  return true;
}

// Build the feed: filter by query, enforce the tier's freshness holdback and
// record cap, attach receipts (+ fixtures on paid tiers), and compute the resume
// cursor. Only RED→GREEN-proven records are ever emitted — an unproven VTI is not
// a sellable, reward-gradable data point.
export function selectFeed(vtis: CorpusVti[], query: FeedQuery, tier: FeedTier): FeedResult {
  const entitlement = TIER_ENTITLEMENTS[tier];
  const nowMs = Date.parse(query.now ?? new Date().toISOString());
  const holdbackMs = entitlement.freshnessHoldbackHours * 3600_000;

  const matched = vtis.filter((v) => proven(v) && matchesQuery(v, query));

  // Freshness holdback: lower tiers don't get the newest records.
  let heldBackFreshness = 0;
  const eligible = matched.filter((v) => {
    if (holdbackMs <= 0 || typeof v.capturedAt !== "string") return true;
    const ageMs = nowMs - Date.parse(v.capturedAt);
    if (ageMs < holdbackMs) {
      heldBackFreshness++;
      return false;
    }
    return true;
  });

  // Oldest-first so the cursor advances monotonically and resumption is clean.
  eligible.sort((a, b) => String(a.capturedAt ?? "").localeCompare(String(b.capturedAt ?? "")));

  const cap = Math.min(
    entitlement.maxRecords ?? Number.POSITIVE_INFINITY,
    query.limit ?? Number.POSITIVE_INFINITY,
  );
  const taken = eligible.slice(0, Number.isFinite(cap) ? cap : eligible.length);

  const records: FeedRecord[] = taken.map((v) => toRecord(v, entitlement));
  const cursor = records.length ? records[records.length - 1].capturedAt ?? null : query.since ?? null;

  return {
    tier,
    entitlement,
    records,
    cursor,
    counts: {
      matchedQuery: matched.length,
      heldBackFreshness,
      emitted: records.length,
      capped: eligible.length - taken.length,
    },
  };
}

function toRecord(v: CorpusVti, ent: TierEntitlement): FeedRecord {
  const rec: FeedRecord = {
    trapId: v.trapId,
    title: typeof v.title === "string" ? v.title : undefined,
    sdk: { name: v.sdk?.name ?? "unknown", version: v.sdk?.version ?? null },
    severity: v.severity,
    class: v.class,
    score: scoreVti(v),
    corroborationCount: Math.max(0, v.corroborationCount ?? 0),
    license: v.license ?? "unknown",
    capturedAt: typeof v.capturedAt === "string" ? v.capturedAt : undefined,
    sourceUrls: extractSourceUrls(v),
    receipt: {
      red: v.redGreenProof?.red === true,
      green: v.redGreenProof?.green === true,
      method: (v.redGreenProof as any)?.method,
      verifiedAt: (v.redGreenProof as any)?.verifiedAt,
    },
  };
  if (ent.includeFixtures) {
    const vuln = (v as any).vulnerable;
    const fixed = (v as any).fixed;
    rec.fixtures = {
      vulnerable: vuln ? { snippet: vuln.snippet, lang: vuln.lang } : undefined,
      fixed: fixed ? { snippet: fixed.snippet, lang: fixed.lang } : undefined,
      generatedTest: (v as any).generatedTest ?? undefined,
    };
  }
  return rec;
}

function extractSourceUrls(v: CorpusVti): string[] {
  const p = (v as any).provenance;
  const urls = p?.sourceUrls ?? (v as any).sourceUrls;
  return Array.isArray(urls) ? urls.filter((u: unknown) => typeof u === "string") : [];
}
