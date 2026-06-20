// ── Token Economics Validator (v0.7.5) ────────────────────────────────────────
//
// The Bags exploit — a creator wallet silently omitted from a fee split, so the
// creator earned $0 forever — was one instance of a whole class:
//
//   A revenue-bearing field in a config object that, if omitted (or zeroed),
//   silently defaults to no value. The call succeeds, nothing reverts, and a
//   fee / royalty / reward is never collected — permanently.
//
// This catalog enumerates that class across the three places money is split:
// **fees**, **royalties**, and **reward distribution**. Each entry names the
// SDK, the exact field, what zero/omitted costs you, and — when one exists —
// the bundled brainblast rule that statically detects it (`economic-value-zero
// -or-missing` / `fee-allocation-shape`). Entries with no rule yet are marked
// `advisory`: a known footgun you should grep for, and a candidate for a
// project-local rule.
//
// Invariant (enforced by test): every non-null `ruleId` resolves to a real
// bundled rule. No false "we catch this".

export type EconomicCategory = "royalty" | "fee" | "reward";
export type EconomicStatus = "enforced" | "advisory";

export interface EconomicPattern {
  /** Stable slug. */
  id: string;
  category: EconomicCategory;
  /** SDK / protocol the field belongs to. */
  sdk: string;
  /** The setup/config call that takes the field. */
  call: string;
  /** The revenue-bearing field that silently defaults to zero. */
  field: string;
  /** What a zero/omitted value costs you, in one sentence. */
  whatZeroMeans: string;
  /** The safe pattern. */
  fix: string;
  /** Bundled rule that detects this, or null for an advisory entry. */
  ruleId: string | null;
  status: EconomicStatus;
  /** Optional reference / docs URL. */
  docsUrl?: string;
}

export const ECONOMIC_PATTERNS: EconomicPattern[] = [
  {
    id: "metaplex-seller-fee",
    category: "royalty",
    sdk: "Metaplex Token Metadata",
    call: "createV1 / createNft / createFungible",
    field: "sellerFeeBasisPoints",
    whatZeroMeans:
      "Omitted → defaults to 0. Creators earn no royalty on any secondary sale, permanently — the token mints fine and looks correct on-chain.",
    fix: "Set sellerFeeBasisPoints explicitly at mint time (e.g. 500 = 5%). There is no after-the-fact migration once minted.",
    ruleId: "metaplex-seller-fee-zero",
    status: "enforced",
    docsUrl: "https://developers.metaplex.com/token-metadata/mint",
  },
  {
    id: "bags-fee-share-creator",
    category: "fee",
    sdk: "Bags",
    call: "createBagsFeeShareConfig",
    field: "feeClaimers[].userBps (creator inclusion)",
    whatZeroMeans:
      "The creator wallet omitted from feeClaimers, or the userBps not summing to 10000 → the creator's share of trading fees is silently zero. This is the original Bags trap.",
    fix: "Include the creator wallet as a feeClaimers entry and ensure every userBps sums to 10000.",
    ruleId: "bags-fee-share-creator-included",
    status: "enforced",
    docsUrl: "https://bags.fm",
  },
  {
    id: "token2022-transfer-fee",
    category: "fee",
    sdk: "SPL Token-2022 (Transfer Fee extension)",
    call: "createInitializeTransferFeeConfigInstruction",
    field: "transferFeeBasisPoints",
    whatZeroMeans:
      "Initializing the transfer-fee extension with 0 basis points → no fee is ever withheld on transfers. The extension is 'configured' but collects nothing.",
    fix: "Pass a non-zero transferFeeBasisPoints (and a sensible maximumFee) when initializing the extension.",
    // Positional-argument call — not an object-literal field, so the bundled
    // object-field checker doesn't cover it yet. Advisory until a positional
    // variant ships.
    ruleId: null,
    status: "advisory",
    docsUrl: "https://www.solana-program.com/docs/token-2022/extensions#transfer-fee",
  },
  {
    id: "reward-rate-zero",
    category: "reward",
    sdk: "Staking / LP reward distributors (generic)",
    call: "initialize / configureReward (varies)",
    field: "rewardRate / emissionsPerSecond",
    whatZeroMeans:
      "A reward-rate or emissions field omitted/zeroed → stakers and LPs accrue nothing while the pool looks live. A silent, ongoing zero-yield misconfiguration.",
    fix: "Set the reward-rate field explicitly and assert it is non-zero in your deploy script; add a project-local economic-value-zero-or-missing rule for your SDK's call shape.",
    ruleId: null,
    status: "advisory",
  },
];

export function getEconomicPattern(id: string): EconomicPattern | undefined {
  return ECONOMIC_PATTERNS.find((e) => e.id === id || e.ruleId === id);
}

export function economicPatternsByCategory(cat: EconomicCategory): EconomicPattern[] {
  return ECONOMIC_PATTERNS.filter((e) => e.category === cat);
}

export function enforcedCount(patterns: EconomicPattern[] = ECONOMIC_PATTERNS): number {
  return patterns.filter((e) => e.status === "enforced").length;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<EconomicCategory, string> = {
  royalty: "Royalties",
  fee: "Fees",
  reward: "Reward distribution",
};

export function renderEconomicsMd(patterns: EconomicPattern[] = ECONOMIC_PATTERNS): string {
  const L: string[] = ["## Token Economics — silent zero-revenue class\n"];
  L.push(
    "The Bags exploit generalized: a revenue-bearing field that, if omitted or zeroed, silently collects nothing — forever. Watch these across every protocol that touches fees, royalties, or rewards.\n",
  );
  L.push("| Category | SDK | Field | Status | Rule |");
  L.push("|----------|-----|-------|--------|------|");
  for (const e of patterns) {
    const status = e.status === "enforced" ? "✅ enforced" : "⚠️ advisory";
    L.push(`| ${CATEGORY_LABEL[e.category]} | ${e.sdk} | \`${e.field}\` | ${status} | ${e.ruleId ? `\`${e.ruleId}\`` : "—"} |`);
  }
  L.push("");
  L.push(`**${enforcedCount(patterns)} of ${patterns.length} enforced by a bundled rule; the rest are advisories (grep targets / project-local rule candidates).**\n`);

  for (const e of patterns) {
    L.push(`### ${e.sdk} — \`${e.field}\` (${CATEGORY_LABEL[e.category]})\n`);
    L.push(`- **Call:** \`${e.call}\``);
    L.push(`- **Zero/omitted means:** ${e.whatZeroMeans}`);
    L.push(`- **Fix:** ${e.fix}`);
    L.push(`- **Detection:** ${e.ruleId ? `\`${e.ruleId}\` (bundled)` : "advisory — no bundled rule yet"}`);
    if (e.docsUrl) L.push(`- **Docs:** ${e.docsUrl}`);
    L.push("");
  }
  return L.join("\n");
}

export function renderEconomicsText(patterns: EconomicPattern[] = ECONOMIC_PATTERNS): string {
  const L: string[] = [];
  L.push("── Token Economics — silent zero-revenue class ───────────────");
  L.push("  fields that default to zero and silently collect nothing");
  L.push("");
  for (const e of patterns) {
    const status = e.status === "enforced" ? "[enforced]" : "[advisory]";
    L.push(`  ${status} ${CATEGORY_LABEL[e.category]}: ${e.sdk} · ${e.field}`);
    L.push(`    ${e.whatZeroMeans}`);
    if (e.ruleId) L.push(`    rule: ${e.ruleId}`);
    L.push("");
  }
  L.push(`  ${enforcedCount(patterns)}/${patterns.length} enforced by a bundled rule`);
  return L.join("\n");
}

export function renderEconomicDetailText(e: EconomicPattern): string {
  const L: string[] = [];
  L.push(`── ${e.sdk} — ${e.field} ──`);
  L.push(`  category:    ${CATEGORY_LABEL[e.category]}`);
  L.push(`  call:        ${e.call}`);
  L.push(`  zero means:  ${e.whatZeroMeans}`);
  L.push(`  fix:         ${e.fix}`);
  L.push(`  detection:   ${e.ruleId ? `${e.ruleId} (bundled rule)` : "advisory — no bundled rule yet"}`);
  if (e.docsUrl) L.push(`  docs:        ${e.docsUrl}`);
  return L.join("\n");
}
