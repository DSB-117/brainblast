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

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { base58Encode, base58Decode } from "./base58.ts";
import { scoreVti, type CorpusVti } from "./corpus.ts";
import { selectFeed, tierForBrain, TIER_ENTITLEMENTS, type FeedTier, type FeedRecord } from "./feed.ts";
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
    minBrainHeld: 100_000,
    note: "Full fixtures + a 24h-delayed delta. Pay in $BRAIN at a 10% discount; USDC accepted → buyback.",
  },
  firehose: {
    tier: "firehose",
    access: "brain-gated",
    priceUsd: 10_000,
    brainDiscountPct: 10,
    priceBrainUsdEquivalent: 9_000,
    minBrainHeld: 1_000_000,
    note: "Unlimited records + the freshest delta (zero holdback). The freshness edge is the moat.",
  },
};

// ---------------------------------------------------------------------------
// Access quote (R4 self-serve) — "given the $BRAIN you hold, here's your tier,
// its price, and how much more buys the next tier." Pure: maps a balance through
// tierForBrain + TIER_PRICING. The no-spend core of self-serve access (North
// Star #1) — a buyer/agent computes eligibility locally; the operator (or, later,
// the server) mints the matching grant. Reading a real on-chain balance and
// actually minting/paying are the spend/secret steps layered on top.
// ---------------------------------------------------------------------------

const TIER_LADDER: FeedTier[] = ["sample", "standard", "firehose"];

export interface AccessQuote {
  brainHeld: number;
  tier: FeedTier;
  access: "open" | "brain-gated";
  priceUsd: number | null;
  priceBrain: number | null; // USD-equivalent at the standing discount
  minBrainForTier: number;
  // The next tier up + how much more $BRAIN it takes — the upsell hint. null at firehose.
  upgrade: { tier: FeedTier; minBrain: number; brainShort: number } | null;
}

export function accessQuote(brainHeld: number): AccessQuote {
  const held = Math.max(0, Number.isFinite(brainHeld) ? brainHeld : 0);
  const tier = tierForBrain(held);
  const p = TIER_PRICING[tier];
  const idx = TIER_LADDER.indexOf(tier);
  let upgrade: AccessQuote["upgrade"] = null;
  if (idx >= 0 && idx < TIER_LADDER.length - 1) {
    const next = TIER_LADDER[idx + 1];
    const minBrain = TIER_PRICING[next].minBrainHeld;
    upgrade = { tier: next, minBrain, brainShort: Math.max(0, minBrain - held) };
  }
  return {
    brainHeld: held,
    tier,
    access: p.access,
    priceUsd: p.priceUsd,
    priceBrain: p.priceBrainUsdEquivalent,
    minBrainForTier: p.minBrainHeld,
    upgrade,
  };
}

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
// Grant — the entitlement record the feed checks before unlocking the paid
// payload, so a buyer cannot self-assert a tier.
//
// R2: grants are signed with **ed25519** by default — the distributor holds a
// private key and PUBLISHES its public key (a Solana-style base58 address), so
// ANYONE can verify a grant with only the public key. This is the foundation a
// public, multi-party market (R3 hosted endpoint) stands on: the verifier no
// longer needs the issuer's secret. The legacy shared-secret **hmac-sha256**
// scheme is still verified (so v0.9.5 grants don't break), selected by the
// grant's own `alg` field.
//
// What's signed is "the grant minus its `sig`" (canonical-JSON, stable key
// order) — so `alg` and `signer` are themselves covered and cannot be swapped,
// and an old HMAC grant (no `alg`/`signer`) reduces to exactly the original
// signed body. ed25519 keys use node:crypto in the same seed(32)/pubkey(32)
// shape as the agent wallet (src/wallet/agentWallet.ts).
// ---------------------------------------------------------------------------

export type GrantAlg = "ed25519" | "hmac-sha256";

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
  alg?: GrantAlg; // absent ⇒ legacy hmac-sha256
  signer?: string; // ed25519: the distributor's base58 address (who signed)
  sig: string; // ed25519: base58 signature · hmac-sha256: hex
}

// How a grant is signed / verified — a discriminated union so the two schemes
// share one code path and the caller picks per environment.
export type GrantSigner = { alg: "ed25519"; secretKey: string } | { alg: "hmac-sha256"; secret: string };
export type GrantVerifier = { alg: "ed25519"; publicKey: string } | { alg: "hmac-sha256"; secret: string };

export interface DistributorKeypair {
  address: string; // base58 ed25519 public key — publish this; verifiers need only it
  secretKey: string; // base58 64-byte (seed‖pubkey) — keep secret (BRAINBLAST_MARKET_KEY)
}

// Standard DER wrappers so a raw 32-byte ed25519 seed / public key becomes a
// node:crypto KeyObject without a JWK round-trip.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function privFromSeed(seed: Buffer) {
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}
function pubFromBytes(pub: Buffer) {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pub]), format: "der", type: "spki" });
}

// Generate a distributor identity: an ed25519 keypair whose base58 public key is
// its address. Same construction the agent wallet uses.
export function generateDistributorKeypair(): DistributorKeypair {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const seed = Buffer.from(jwk.d, "base64url");
  const pub = Buffer.from(jwk.x, "base64url");
  return { address: base58Encode(pub), secretKey: base58Encode(Buffer.concat([seed, pub])) };
}

// The distributor address implied by a secret key (so `issue` can stamp `signer`
// and `keygen` can echo it). Accepts a 64-byte (seed‖pub) or 32-byte (seed) key.
export function addressFromSecretKey(secretKeyB58: string): string {
  const secret = base58Decode(secretKeyB58);
  const seed = secret.subarray(0, 32);
  const pub = createPublicKey(privFromSeed(seed)).export({ format: "jwk" }) as { x: string };
  return base58Encode(Buffer.from(pub.x, "base64url"));
}

function hmacHex(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export interface IssueGrantArgs {
  buyer: string;
  tier: FeedTier;
  lots: string[];
  signer: GrantSigner;
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

  if (args.signer.alg === "ed25519") {
    const seed = base58Decode(args.signer.secretKey).subarray(0, 32);
    const body = { ...payload, alg: "ed25519" as const, signer: addressFromSecretKey(args.signer.secretKey) };
    const sig = base58Encode(cryptoSign(null, Buffer.from(canonicalJson(body)), privFromSeed(seed)));
    return { ...body, sig };
  }
  const body = { ...payload, alg: "hmac-sha256" as const };
  return { ...body, sig: hmacHex(canonicalJson(body), args.signer.secret) };
}

export interface GrantVerification {
  valid: boolean;
  reason?: "bad-signature" | "expired" | "malformed" | "wrong-verifier" | "untrusted-signer";
  tier?: FeedTier;
  buyer?: string;
  lots?: string[];
  signer?: string;
}

export function verifyGrant(grant: Grant, verifier: GrantVerifier, now?: string): GrantVerification {
  if (!grant || typeof grant !== "object" || typeof grant.sig !== "string" || !grant.buyer || !grant.tier) {
    return { valid: false, reason: "malformed" };
  }
  const alg: GrantAlg = grant.alg ?? "hmac-sha256";
  if (verifier.alg !== alg) return { valid: false, reason: "wrong-verifier" };

  const { sig, ...body } = grant;
  const message = canonicalJson(body);

  if (alg === "ed25519") {
    if (verifier.alg !== "ed25519") return { valid: false, reason: "wrong-verifier" };
    // The grant must be signed by the distributor we trust — not just any key.
    if (!grant.signer || grant.signer !== verifier.publicKey) return { valid: false, reason: "untrusted-signer" };
    let ok = false;
    try {
      ok = cryptoVerify(null, Buffer.from(message), pubFromBytes(base58Decode(verifier.publicKey)), base58Decode(sig));
    } catch {
      return { valid: false, reason: "bad-signature" };
    }
    if (!ok) return { valid: false, reason: "bad-signature" };
  } else {
    if (verifier.alg !== "hmac-sha256") return { valid: false, reason: "wrong-verifier" };
    const expected = hmacHex(message, verifier.secret);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "bad-signature" };
  }

  if (grant.expiresAt != null) {
    const nowMs = Date.parse(now ?? new Date().toISOString());
    if (nowMs >= Date.parse(grant.expiresAt)) return { valid: false, reason: "expired" };
  }
  return { valid: true, tier: grant.tier, buyer: grant.buyer, lots: grant.lots, signer: grant.signer };
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
