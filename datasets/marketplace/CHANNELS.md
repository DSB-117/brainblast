# Distribution channels — every avenue to sell & scale the corpus

**Status:** strategy map. **Not legal/financial advice.** Pairs with
[DATA-LICENSE.md](DATA-LICENSE.md) (rights), [BRAIN-UTILITY.md](BRAIN-UTILITY.md)
(token boundary), [CLEANROOM-SPEC.md](CLEANROOM-SPEC.md) (the sellable record).

One export, many storefronts. The clean-room NDJSON (`npm run export:cleanroom`) is
the **single canonical artifact**; every channel below is a re-skin of it plus that
channel's metadata. Never fork the data per channel — fork the listing.

The through-line for all of them: **the only code-training data with a
machine-checkable RED→GREEN proof.** Lead every channel with the eval number from
`bench/footgun-eval` (how much training on the corpus cuts a model's footgun rate).

---

## The avenue matrix

Effort/Reach/Margin are relative (◔ low → ● high). "Ships raw?" = does the buyer
receive the corpus bytes (vs. access-only / model-only).

| # | Channel | What we sell there | Effort | Reach | Margin | Ships raw? | Rights load | Status / gate |
|---|---|---|---|---|---|---|---|---|
| 1 | **Brainblast direct** (registry.brainblast.tech) | live feed + lot/package/Scale, SOL/USDC/$BRAIN | — | ◔ | ● | yes (grant-gated) | owned+wild | **LIVE** — self-serve sales shipped |
| 2 | **Opendatabay / Defined.ai** | owned-tier snapshot NDJSON, General/Commercial SKUs | ◔ | ◑ | ◑ | yes | owned first | ready kit ([OPENDATABAY-PACKAGE.md](OPENDATABAY-PACKAGE.md)); gate = counsel sign-off |
| 3 | **Hugging Face Hub** (gated dataset + paid tier) | free receipt-only sample as reach magnet; paid full via HF | ◔ | ● | ◑ | sample yes / full gated | owned first | fastest reach; sample = the `/api/feed` anon tier |
| 4 | **Kaggle / GitHub public sample** | tiny open sample as SEO + credibility funnel to (1) | ◔ | ● | ◔ (funnel) | sample only | owned | pure funnel, no revenue directly |
| 5 | **AWS Data Exchange / Snowflake Marketplace** | enterprise snapshot subscription | ◑ | ◑ | ◑ | yes | owned+warranty | enterprise procurement reach; needs entity + agreements |
| 6 | **Direct enterprise / lab licensing** | bespoke Commercial license, indemnity, custom lots | ● | ◔ | ● | yes | owned+wild+indemnity | highest $/deal; the eval number is the sales lead |
| 7 | **Bittensor subnet / oracle** | data as subnet commodity; checker as validator | ● | ◑ | ● (owner emission) | via validated corpus | alpha/TAO | design + scaffold shipped ([BITTENSOR.md](BITTENSOR.md)); Path A now, Path B on payback |
| 8 | **Vana DataDAO (VRC-20)** | tokenized dataset, tradeable on Solana | ● | ◑ | ◑ | access-tokenized | **HIGH** (securities) | Phase 2 only; **work-weighted not holder-weighted** or stop |
| 9 | **Ocean Protocol (compute-to-data)** | sell *access to compute over* the data, raw never leaves | ● | ◔ | ◑ | **no** (C2D) | lowest (no redistribution) | best-fit for wild tier — buyer trains without receiving bytes |
| 10 | **Sahara AI marketplace** | dataset listing on onchain AI marketplace w/ provenance | ◑ | ◑ | ◑ | yes | owned first | emerging; onchain provenance + revenue-share fits our receipts |
| 11 | **Eval/benchmark productization** | sell the *held-out eval set* + the harness as a paid benchmark | ◑ | ◑ | ● | eval-only | owned | differentiator; labs pay to measure footgun-rate ([footgun-eval](../../packages/core/scripts/footgun-eval.mts)) |
| 12 | **API metered access** | pay-per-call VTI lookup / "is this pattern a known footgun?" | ◑ | ◑ | ● | no (query) | lowest | reuses grant infra; agent-native distribution |

## How the channels layer (not compete)

- **Funnel tier (reach, ~free):** HF sample (3), Kaggle/GitHub (4). Job: get the eval
  number and the receipt in front of every ML engineer. Route all traffic to (1).
- **Marketplace tier (discovery + credibility):** Opendatabay/Defined.ai (2), AWS/
  Snowflake (5), Sahara (10). Job: legal credibility + procurement reach; take the
  commission hit on one-time snapshots, keep the **live feed** on (1).
- **High-margin tier (the money):** direct enterprise/lab (6), eval-as-benchmark
  (11), metered API (12), Bittensor owner-emission (7). Job: capture real budget.
- **Access-not-bytes tier (rights-safe scaling):** Ocean C2D (9), API (12). Job:
  monetize the **wild tier** without ever shipping third-party-adjacent bytes — the
  buyer computes over data they never receive. This is how wild scales cleanly.
- **Token-native tier (highest risk):** Vana (8), Bittensor alpha (7). Real upside,
  real classification risk — gated behind counsel and the work-not-holder rule.

## Sequencing (do in this order)

1. **Now (revenue + reach, low risk):** (1) live ✔ · publish HF sample (3) + Kaggle
   funnel (4) · list owned tier on Opendatabay (2) once counsel signs off.
2. **Q+1 (margin):** stand up eval-as-benchmark (11) and the metered API (12) —
   both reuse infra already built (footgun-eval, grants). Start direct enterprise
   outreach (6) leading with the eval number.
3. **Q+2 (rights-safe scale):** Ocean compute-to-data (9) for the wild tier; AWS/
   Snowflake (5) + Sahara (10) for procurement reach.
4. **Q+3+ (token-native, gated):** Bittensor Path A oracle/miner (7) → Path B subnet
   on payback; Vana (8) **only** if structured work-weighted and cleared by counsel.

## Non-negotiables across every channel

- One canonical export (`toCleanroom`); re-skin metadata, never fork the data.
- **Owned tier first** everywhere; wild tier only after the by-reference model +
  GPL/AGPL exclusion pass clears counsel ([DATA-LICENSE.md](DATA-LICENSE.md)).
- Never grant exclusivity (kills every other channel).
- Never ship verbatim third-party code — provenance by reference only.
- $BRAIN stays a consumptive/work rail; token-native channels use their own token.

Sources for the token-native channels: [Vana VRC-20 on Solana](https://www.vana.org/posts/trading-vrc20-data-tokens-on-solana),
[Vana: create a DataDAO](https://docs.vana.org/docs/quick-start-create-a-datadao),
[Sahara AI 2026 roadmap](https://saharaai.com/blog/2026-roadmap),
[Bittensor subnets](https://docs.learnbittensor.org/subnets/understanding-subnets).
