# Opendatabay (and Defined.ai) listing package

**Status:** ready-to-fill listing kit. Goal: get the **owned tier** live on an
established AI-data marketplace for reach + legal credibility, at low effort,
gated only on the counsel review in DATA-LICENSE.md.

**Sequencing note:** list the **owned tier first** (synthetic-owned records —
authored fixtures, docs-cited, zero third-party content = cleanest warranty). Add
the **wild tier** after counsel signs off on the by-reference model + the GPL/AGPL
exclusion pass.

---

## Listing metadata (paste into the provider form)

- **Title:** Brainblast — Verified SDK Footgun Corpus (RED→GREEN proven code pairs)
- **Category:** Code / Software · AI & LLM training data · Security
- **Short description:** Machine-verified pairs of *insecure* and *fixed* code for
  real SDK footguns — each with a replayable RED→GREEN proof. Every record: the
  vulnerable code, the corrected code, a one-line lesson, and an oracle receipt
  proving the checker fails the vulnerable and passes the fixed. NDJSON, AI-ready.
- **Format:** NDJSON (`.jsonl`), UTF-8, one VTI per line + fixtures as files.
- **Update cadence:** live — new proven traps added continuously by the sourcing fleet.
- **License options offered:** General AI License · Commercial AI License (see DATA-LICENSE.md).
- **Provenance:** every record cites a public source (official docs for owned-tier;
  commit-pinned URL + SHA-256 line hash for wild-tier — buyer-verifiable).
- **Tags:** llm-training, code, security, static-analysis, typescript, solidity,
  go, solana, aws, auth, tls, sdk-misuse, agentic-ai, fine-tuning.

## Why it's differentiated (the pitch line for the card)

> The only code-training data that ships with a **machine-checkable proof**: for
> every record, a deterministic checker demonstrably fails the insecure version and
> passes the fixed one. No answer key to trust — replay the receipt.

## Data dictionary (buyer-facing)

| Field | Meaning |
|---|---|
| `trapId` | stable id |
| `sdk.{name,version,type}` | the SDK + version window the footgun lives in |
| `severity`, `class` | risk + taxonomy (auth-bypass, missing-slippage-guard, missing-verification, silent-zero-revenue, wrong-constant, unconfirmed-state, …) |
| `vulnerable.code` / `fixed.code` | the trainable pair (authored minimal repros) |
| `lesson` | one-paragraph description of the footgun and its fix |
| `redGreenProof` | `{red,green,method,checkKind,verifiedAt,engineVersion}` — the replayable receipt |
| `provenance` | owned: doc URLs · wild: `sourceRef@sha`, `sourceUrl`, `evidenceSha256`, `evidenceLen` |
| `rights.provenanceClass` | `synthetic-owned` \| `wild` (which warranty applies) |
| `corroborationCount` | # independent repos the pattern was seen in |

## Sample pack (free preview — build from the open `sample` tier)

- 25–50 **owned-tier** records spanning ≥6 lots (auth, tls, cloud-storage, crypto,
  evm, solana), fixtures included, full proof receipts.
- A `README` + this data dictionary + a 1-page "how to verify a receipt".
- Ship the same **receipt-only sample** the registry already exposes at
  `/api/feed` (anonymous tier) so the marketplace preview == the live product.

## Pricing (map existing lot pricing → marketplace SKUs)

Brainblast lots are already coverage-priced ($1,500–$3,500/lot, Scale $16k). For a
marketplace one-time-download SKU, price a **snapshot** (not the live feed):

| SKU | Contents | Suggested list |
|---|---|---|
| Lot snapshot (General AI) | one lot, current corpus | ~1× the lot's annual ($1.5k–$3.5k) |
| Lot snapshot (Commercial AI) | one lot, commercial rights | ~2–2.5× |
| Full corpus snapshot (Commercial) | all owned-tier lots | ~$20k–$30k |
| Live feed (upsell to Brainblast direct) | continuous updates + grant | route to registry self-serve |

Marketplace takes ~5–30% commission; keep the **live feed** on Brainblast direct
(higher margin, and the grant/usage-ledger infra already exists) and use the
marketplace for **discovery + one-time snapshots + legal credibility**.

## Export pipeline (what to build — small)

1. `npm run export:cleanroom -- --tier owned --lots auth,tls,crypto,cloud-storage,evm,solana`
   → runs `toCleanroom()` (CLEANROOM-SPEC) over the corpus, filters by
   `provenanceClass`, runs `cleanroom-validate`, emits `dist/marketplace/<lot>.jsonl`
   + fixtures + `MANIFEST.json` (counts, checksums, schema, license).
2. Attach `DATA-LICENSE.md` (the chosen SKU) + this data dictionary.
3. Upload to Opendatabay; set price + license per SKU; publish.

## Checklist before publishing (hard gate)

- [ ] Counsel sign-off on DATA-LICENSE.md (esp. by-reference model + warranty).
- [ ] Owned-tier only for v1 (no wild records until Q1–Q3 in DATA-LICENSE resolved).
- [ ] `cleanroom-validate` passes 100% on the export (no `evidence` strings leaked).
- [ ] Sample pack renders + a buyer can verify one receipt end-to-end.
- [ ] Rights/warranty statement attached; provider provider-agreement warranties reviewed.

## Other marketplaces (same package, minor reframing)

- **Defined.ai** — same NDJSON + dictionary; emphasize agentic/code trajectories.
- **Innodata / Trainspot** — synthetic + creator-licensing angle; owned tier fits.
- Keep **one canonical export** (`toCleanroom`) and re-skin metadata per marketplace.
