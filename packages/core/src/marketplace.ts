// The marketplace surface — Stage 4 Step 2 of ROADMAP-TRAINING-DATA.md.
//
// The feed (feed.ts) computes tier *eligibility* client-side; its own comments
// say five times that "real entitlement is enforced server-side at
// distribution." This module is that distribution layer, built local-first to
// match the codebase's honest client/server split:
//
//   1. catalog   — the buyer-facing storefront (what's for sale, coverage,
//                  freshness, the tier/price ladder, receipt-only teasers).
//   2. grant     — the actual entitlement: a tamper-evident record (buyer, tier,
//                  lot scope, expiry) the issuer signs and the distributor
//                  verifies before serving the paid payload. A buyer can no
//                  longer self-assert `--tier firehose`.
//   3. metering  — an append-only, hash-chained usage ledger so every pull is
//                  accounted per buyer (the basis for usage billing).
//
// Pure: no fs/network. The CLI (runCatalog / runGrant / runUsage / feed --grant)
// does the reading/writing. Keeping this pure makes the access + integrity model
// fully unit-testable, exactly like feed.ts and corpus.ts.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { scoreVti, type CorpusVti } from "./corpus.ts";
import { selectFeed, TIER_ENTITLEMENTS, type FeedTier, type FeedRecord } from "./feed.ts";
import type { TrapClass } from "./vtiClass.ts";

// ---------------------------------------------------------------------------
// Canonical serialization — stable key order so a hash/signature is reproducible
// regardless of how an object was constructed. The integrity primitive shared by
// grant signing and the usage hash-chain.
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Pricing ladder — kept consistent with datasets/v0.1.0/index.json. USD is the
// on-ramp; $BRAIN is the unit of access at a standing discount; USDC pays full
// and triggers buyback. Settlement itself spends funds and stays a deliberate,
// out-of-band step — this surface only *quotes* the price, it never moves money.
// ---------------------------------------------------------------------------

export interface TierPricing {
  tier: FeedTier;
  access: "open" | "brain-gated";
  priceUsd: number | null;
  brainDiscountPct: number;
  priceBrainUsdEquivalent: number | null;
  minBrainHeld: number; // mirrors TIER_BRAIN_THRESHOLDS
  note: string;
}

export const TIER_PRICING: Record<FeedTier, TierPricing> = {
  sample: {
    tier: "sample",
    access: "open",
    priceUsd: null,
    brainDiscountPct: 0,
    priceBrainUsdEquivalent: null,
    minBrainHeld: 0,
    note: "Open teaser: metadata + the RED→GREEN receipt (the proof). No trainable fixtures.",
  },
  standard: {
    tier: "standard",
    access: "brain-gated",
    priceUsd: 2500,
    brainDiscountPct: 10,
    priceBrainUsdEquivalent: 2250,
    minBrainHeld: 1_000,
    note: "Full fixtures + a 24h-delayed delta. Pay in $BRAIN at a 10% discount; USDC accepted → buyback.",
  },
  firehose: {
    tier: "firehose",
    access: "brain-gated",
    priceUsd: 10_000,
    brainDiscountPct: 10,
    priceBrainUsdEquivalent: 9_000,
    minBrainHeld: 10_000,
    note: "Unlimited records + the freshest delta (zero holdback). The freshness edge is the moat.",
  },
};

// ---------------------------------------------------------------------------
// Catalog — the storefront. Built from the lots the seller holds.
// ---------------------------------------------------------------------------

export interface CatalogResult {
  schemaVersion: "1.0";
  dataset: string;
  generatedAt: string;
  counts: { total: number; proven: number; sdks: number; classes: number };
  severityDistribution: Record<string, number>;
  classDistribution: Record<string, number>;
  sdkDistribution: Record<string, number>;
  licenseDistribution: Record<string, number>;
  quality: { mean: number; min: number; max: number };
  freshness: { oldest: string | null; newest: string | null };
  tiers: TierPricing[];
  // Receipt-only teasers (the open sample tier): metadata + proof, never fixtures.
  teasers: FeedRecord[];
}

export interface CatalogOptions {
  dataset?: string;
  now?: string;
  teaserLimit?: number;
}

function proven(v: CorpusVti): boolean {
  return v.redGreenProof?.red === true && v.redGreenProof?.green === true;
}

function tally<T extends string>(items: T[]): Record<string, number> {
  const d: Record<string, number> = {};
  for (const i of items) d[i] = (d[i] ?? 0) + 1;
  return d;
}

export function buildCatalog(vtis: CorpusVti[], opts: CatalogOptions = {}): CatalogResult {
  const provenVtis = vtis.filter(proven);
  const scores = provenVtis.map(scoreVti);
  const sdks = new Set(provenVtis.map((v) => v.sdk?.name ?? "unknown"));
  const classes = new Set(provenVtis.map((v) => v.class));
  const captured = provenVtis
    .map((v) => v.capturedAt)
    .filter((c): c is string => typeof c === "string")
    .sort();

  // Teasers reuse the feed's sample-tier selection (receipt-only, no fixtures) —
  // one code path for "what a non-buyer sees." But the freshness HOLDBACK is a
  // *delivery* concern (don't stream the newest delta to a low tier), not a
  // *catalog* one: the storefront must always show that records exist. So we
  // select as-of a far-future instant, neutralizing the holdback while keeping
  // the receipt-only entitlement.
  const FAR_FUTURE = "9999-01-01T00:00:00Z";
  const teaser = selectFeed(
    provenVtis,
    { limit: opts.teaserLimit ?? TIER_ENTITLEMENTS.sample.maxRecords ?? 5, now: FAR_FUTURE },
    "sample",
  );

  return {
    schemaVersion: "1.0",
    dataset: opts.dataset ?? "brainblast-verified-traps",
    generatedAt: opts.now ?? new Date().toISOString(),
    counts: { total: vtis.length, proven: provenVtis.length, sdks: sdks.size, classes: classes.size },
    severityDistribution: tally(provenVtis.map((v) => v.severity)),
    classDistribution: tally(provenVtis.map((v) => String(v.class) as TrapClass)),
    sdkDistribution: tally(provenVtis.map((v) => v.sdk?.name ?? "unknown")),
    licenseDistribution: tally(provenVtis.map((v) => v.license ?? "unknown")),
    quality: {
      mean: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      min: scores.length ? Math.min(...scores) : 0,
      max: scores.length ? Math.max(...scores) : 0,
    },
    freshness: { oldest: captured[0] ?? null, newest: captured[captured.length - 1] ?? null },
    tiers: [TIER_PRICING.sample, TIER_PRICING.standard, TIER_PRICING.firehose],
    teasers: teaser.records,
  };
}

// Render the catalog as buyer-facing Markdown (the committed storefront, like
// COVERAGE.md / SLA.md). Pure — the caller writes the file.
export function renderCatalogMd(c: CatalogResult, lots: string[]): string {
  const L: string[] = [];
  L.push(`# ${c.dataset} — catalog`);
  L.push("");
  L.push(`_Generated ${c.generatedAt} from ${lots.length} lot(s): ${lots.map((l) => l.split("/").pop()).join(", ")}._`);
  L.push("");
  L.push(
    `**${c.counts.proven} verified trap instances** across **${c.counts.sdks} SDKs** and **${c.counts.classes} trap classes**. Quality score mean ${c.quality.mean}/100 (range ${c.quality.min}–${c.quality.max}). Freshness: ${c.freshness.oldest ?? "—"} → ${c.freshness.newest ?? "—"}.`,
  );
  L.push("");
  L.push("Every record is RED→GREEN-proven and ships its reproducibility receipt — the credibility scraped data can't offer.");
  L.push("");
  L.push("## Access tiers");
  L.push("");
  L.push("| Tier | Access | Price (USD) | In $BRAIN (10% off) | Min $BRAIN held | What you get |");
  L.push("|---|---|---|---|---|---|");
  for (const t of c.tiers) {
    const usd = t.priceUsd == null ? "free" : `$${t.priceUsd.toLocaleString()}`;
    const brain = t.priceBrainUsdEquivalent == null ? "—" : `$${t.priceBrainUsdEquivalent.toLocaleString()}`;
    L.push(`| ${t.tier} | ${t.access} | ${usd} | ${brain} | ${t.minBrainHeld.toLocaleString()} | ${t.note} |`);
  }
  L.push("");
  L.push(
    "> USD is the on-ramp; $BRAIN is the unit of access at a standing discount. USDC accepted at full price → programmatic buyback into the contributor/burn pool. Settlement is a deliberate, out-of-band step — this catalog only quotes the price.",
  );
  L.push("");
  L.push("## Coverage by trap class");
  L.push("");
  L.push("| Class | Count |");
  L.push("|---|---|");
  for (const [k, v] of Object.entries(c.classDistribution).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push("");
  L.push("## Coverage by SDK");
  L.push("");
  L.push("| SDK | Count |");
  L.push("|---|---|");
  for (const [k, v] of Object.entries(c.sdkDistribution).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push("");
  L.push("## Sample (receipt-only teasers)");
  L.push("");
  L.push("The open sample tier shows metadata + the RED→GREEN receipt (proof we have it) — never the trainable fixtures.");
  L.push("");
  L.push("| Trap | SDK | Class | Severity | Score | Corroboration | RED→GREEN |");
  L.push("|---|---|---|---|---|---|---|");
  for (const r of c.teasers) {
    const rg = `${r.receipt.red ? "✓" : "✗"}/${r.receipt.green ? "✓" : "✗"}`;
    L.push(`| ${r.trapId} | ${r.sdk.name} | ${r.class} | ${r.severity} | ${r.score} | ${r.corroborationCount} | ${rg} |`);
  }
  L.push("");
  L.push("---");
  L.push("");
  L.push(
    "To buy: obtain a signed access grant for your tier, then `brainblast feed --grant <file>` streams the delta filtered to your stack. Each pull is metered (`brainblast usage`).",
  );
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Grant — the entitlement record. The local stand-in for server-side
// distribution control. The issuer holds a secret and signs; the distributor
// (who also holds the secret, because issuer == distributor in this model)
// verifies before unlocking the paid payload. A buyer cannot forge a tier.
//
// NOTE (honesty): HMAC means issuer and verifier share a secret — correct for a
// self-hosted distributor verifying grants it issued. Production multi-party
// distribution would upgrade `sig` to an ed25519 signature over the same
// canonical payload (the wallet already generates ed25519 keys); the verify path
// is structured so only `signGrant`/`verifyGrant` change.
// ---------------------------------------------------------------------------

export interface GrantPayload {
  grantVersion: "1.0";
  buyer: string;
  tier: FeedTier;
  lots: string[]; // lot scope: which lot files this grant entitles (basenames)
  issuedAt: string;
  expiresAt: string | null;
  nonce: string;
}

export interface Grant extends GrantPayload {
  sig: string; // hex HMAC-SHA256 over canonicalJson(payload)
}

function signGrant(payload: GrantPayload, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(payload)).digest("hex");
}

export interface IssueGrantArgs {
  buyer: string;
  tier: FeedTier;
  lots: string[];
  secret: string;
  now?: string;
  ttlDays?: number | null; // null = never expires
}

export function issueGrant(args: IssueGrantArgs): Grant {
  const issuedAt = args.now ?? new Date().toISOString();
  const expiresAt =
    args.ttlDays == null ? null : new Date(Date.parse(issuedAt) + args.ttlDays * 86_400_000).toISOString();
  const payload: GrantPayload = {
    grantVersion: "1.0",
    buyer: args.buyer,
    tier: args.tier,
    lots: [...args.lots].sort(),
    issuedAt,
    expiresAt,
    nonce: randomBytes(12).toString("hex"),
  };
  return { ...payload, sig: signGrant(payload, args.secret) };
}

export interface GrantVerification {
  valid: boolean;
  reason?: "bad-signature" | "expired" | "malformed";
  tier?: FeedTier;
  buyer?: string;
  lots?: string[];
}

export function verifyGrant(grant: Grant, secret: string, now?: string): GrantVerification {
  if (!grant || typeof grant !== "object" || typeof grant.sig !== "string" || !grant.buyer || !grant.tier) {
    return { valid: false, reason: "malformed" };
  }
  const { sig, ...payload } = grant;
  const expected = signGrant(payload as GrantPayload, secret);
  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "bad-signature" };
  if (grant.expiresAt != null) {
    const nowMs = Date.parse(now ?? new Date().toISOString());
    if (nowMs >= Date.parse(grant.expiresAt)) return { valid: false, reason: "expired" };
  }
  return { valid: true, tier: grant.tier, buyer: grant.buyer, lots: grant.lots };
}

// ---------------------------------------------------------------------------
// Metering ledger — append-only, hash-chained. Each pull against a grant becomes
// one entry whose hash covers the previous entry's hash, so any edit/removal of
// history breaks the chain (the SHA256SUMS tamper-evidence discipline, applied
// to usage). This is the accounting basis for usage-based billing.
// ---------------------------------------------------------------------------

export const LEDGER_GENESIS = "0".repeat(64);

export interface UsageRecord {
  ts: string;
  buyer: string;
  tier: FeedTier;
  lots: string[];
  recordsServed: number;
  cursor: string | null;
  query?: Record<string, unknown>;
}

export interface UsageEntry extends UsageRecord {
  seq: number;
  prevHash: string;
  hash: string;
}

function hashEntry(e: Omit<UsageEntry, "hash">): string {
  return sha256Hex(canonicalJson(e));
}

// Append one usage record, chaining onto the prior ledger. Returns the new entry
// (the caller appends it to the ledger file).
export function appendUsage(prior: UsageEntry[], rec: UsageRecord): UsageEntry {
  const last = prior[prior.length - 1];
  const prevHash = last ? last.hash : LEDGER_GENESIS;
  const seq = last ? last.seq + 1 : 0;
  const base: Omit<UsageEntry, "hash"> = { ...rec, lots: [...rec.lots].sort(), seq, prevHash };
  return { ...base, hash: hashEntry(base) };
}

export interface LedgerVerification {
  valid: boolean;
  brokenAt?: number; // seq of the first tampered/broken entry
  reason?: "bad-hash" | "broken-chain" | "bad-sequence";
}

// Re-derive the chain end to end; any mismatch localizes the first break.
export function verifyLedger(entries: UsageEntry[]): LedgerVerification {
  let prevHash = LEDGER_GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { valid: false, brokenAt: e.seq, reason: "bad-sequence" };
    if (e.prevHash !== prevHash) return { valid: false, brokenAt: e.seq, reason: "broken-chain" };
    const { hash, ...rest } = e;
    if (hashEntry(rest) !== hash) return { valid: false, brokenAt: e.seq, reason: "bad-hash" };
    prevHash = e.hash;
  }
  return { valid: true };
}

export interface BuyerUsage {
  buyer: string;
  pulls: number;
  recordsServed: number;
  lastSeen: string;
  tiers: FeedTier[];
}

export function summarizeUsage(entries: UsageEntry[]): BuyerUsage[] {
  const byBuyer = new Map<string, BuyerUsage>();
  for (const e of entries) {
    const u = byBuyer.get(e.buyer) ?? { buyer: e.buyer, pulls: 0, recordsServed: 0, lastSeen: e.ts, tiers: [] };
    u.pulls += 1;
    u.recordsServed += e.recordsServed;
    if (e.ts > u.lastSeen) u.lastSeen = e.ts;
    if (!u.tiers.includes(e.tier)) u.tiers.push(e.tier);
    byBuyer.set(e.buyer, u);
  }
  return [...byBuyer.values()].sort((a, b) => b.recordsServed - a.recordsServed);
}
