# $BRAIN utility — the data-layer rail, kept clear of the securities line

**Status:** design + guardrails · **NOT legal/financial advice.** Token
classification is fact- and jurisdiction-specific; a securities attorney must
review any change that touches holder economics before it ships.

$BRAIN (`7qSrCNchoiFxtxikTJm8x892tGdrtNgsaghfcnDBpump`) already does real work in
the registry: it gates tier eligibility and pays for access at a standing 10%
discount. This doc **tightens** that into a coherent utility rail and draws a
bright line around the features that would make it look like a security.

---

## Design principle: consumptive utility, not an investment

The whole posture is to keep $BRAIN a **thing you spend to use the data layer and
earn for doing work in it** — never a thing you buy expecting profit from others'
efforts. Every function below is either *access* (you consume it) or *reward for
work* (you earned it by contributing verifiable value). None distribute the
enterprise's profits to passive holders.

## The four sanctioned functions

1. **Access / payment (consumptive).** Pay for lot/package/Scale access in $BRAIN
   at a standing discount vs USDC/SOL. Already live. $BRAIN is the *unit of access*.
2. **Eligibility gating (consumptive).** Holding ≥ threshold unlocks a tier's
   *eligibility to buy* (not a payout). Already live (100k / 1M thresholds).
3. **Contributor rewards (earned for work).** When a scout/oracle submits a trap
   that **proves RED→GREEN and survives reprove**, they earn $BRAIN from a fixed
   contributor pool. Reward is a function of *verifiable work delivered* (novel
   proven pattern, corroboration weight), not of token price or others' spending.
4. **Quality bonds / curation stake (earned + slashable, tied to data validity).**
   A curator may **bond $BRAIN on a VTI's continued validity.** If the VTI keeps
   reproducing, the bond is returned + a small curation reward from the pool. If it
   **stops reproducing** (the slash trigger — already implemented in the stake
   indexer), the bond is slashed. The stake outcome is tied to an **objective,
   verifiable data fact** (does the trap still prove?), not to price or revenue.

## The bright line — features to AVOID (they invite security classification)

- ❌ **Revenue/dividend distribution to holders.** Do not route a % of sales to
  $BRAIN holders pro-rata. (Contributor rewards are for *work*, funded from a fixed
  pool — keep that framing and accounting strictly separate from sales revenue.)
- ❌ **Staking that pays a yield for locking** (passive return on capital).
- ❌ **Buyback-and-distribute-to-holders.** (A treasury buyback that funds the
  *contributor reward pool* is defensible; distributing to passive holders is not.
  Keep any buyback pointed at the work-reward pool + burn, never at holders.)
- ❌ **Marketing that promises price appreciation / "investible subnet" / ROI.**
- ❌ **Governance over profit.** Utility governance (which SDKs to scout, quality
  params) is fine; governance that directs enterprise profits is not.

## Consequences for the marketplace channels

- **Brainblast direct:** $BRAIN as access + discount + contributor reward. Clean.
- **Vana DataDAO (Phase 2):** attractive, but a DataDAO that **distributes pool
  income to token holders** is the classic security-shaped structure. If pursued,
  structure rewards as **contribution-weighted (work), not holding-weighted
  (capital)**, and get an opinion first. This is the single highest-risk item in
  the whole monetization plan — flag it loudly.
- **Ocean / Bittensor:** their tokens, their classification; $BRAIN stays the
  Brainblast-side access/reward rail and settles into those only as a payment.

## Accounting separation (make the "work not profit" claim true)

- **Sales revenue** → treasury (operations). Never auto-split to holders.
- **Contributor reward pool** → a *separately funded, capped* budget (fixed
  emission or a fixed treasury allocation), paid out on proven-work events. Its
  size is not a function of sales.
- Keep these two ledgers visibly separate so the "rewards are for work, not a
  share of profits" position is factually supported.

## Minimal build (all additive to what exists)

1. **Contributor-reward emitter:** on reprove flipping `proof_verified=true` for a
   *new* pattern, credit the author's wallet from the reward pool (the wallet is
   already recorded on the stake/submission). Reuse the stake indexer + payout path.
2. **Curation bond:** generalize the existing `stake_submissions` bond to a
   *validity bond* on any VTI (bond → returned+reward on continued reproduction,
   slashed on the existing slash trigger). Mostly wiring; the slash logic exists.
3. **Docs:** publish this utility framing on the site (consumptive + work-reward),
   and scrub any price/appreciation language.

## What to route to counsel before shipping

- The contributor-reward pool structure + funding source (must be work-not-revenue).
- Any Vana/DataDAO token economics (holding-weighted anything = stop).
- Jurisdictional token classification for $BRAIN as an access/reward token.
