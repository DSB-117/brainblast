# Brainblast Training-Data License 1.0 + rights statement

**Status:** draft for counsel review — NOT legal advice. This is the commercial
scaffolding; a qualified IP/data attorney must review before external listing,
especially the wild-tier warranty and the by-reference provenance model.

---

## What the buyer is buying

A **license to use the Brainblast Verified Trap Instance (VTI) corpus (or a lot/
package thereof) to train, fine-tune, evaluate, and build software** — including
AI/ML models. The licensed artifact is, per record:

- the **authored `vulnerable` and `fixed` code fixtures**,
- the **`lesson`** (a factual description of the footgun and its fix),
- the **`generatedTest`** and the **`redGreenProof`** receipt,
- **provenance by reference** (a commit-pinned URL + a SHA-256 of the matched line).

The buyer does **not** receive, and Brainblast does not grant rights in, any
third-party source code. Wild-tier records point at public commits; the buyer may
fetch that public source under its own upstream license, at its own discretion.

## Two license SKUs (map to Opendatabay's General / Commercial AI License)

- **General AI License** — train/evaluate models, internal use, research. No
  redistribution of the raw corpus.
- **Commercial AI License** — the above + use in commercial products/models sold
  to third parties. Still no redistribution of the raw corpus; the buyer may ship
  *models trained on it*.

Both are **non-exclusive** (critical: never grant exclusivity — it kills every
other channel and inflates warranty risk). Term = the subscription term; the
signed ed25519 grant already encodes tier + lot-scope + expiry.

## The rights we can warrant (by provenance class)

The clean-room split (see CLEANROOM-SPEC.md) lets us give an **honest, tiered
warranty** instead of an unbackable blanket one:

| Tier | What we warrant | Basis |
|---|---|---|
| **Owned** (`synthetic-owned`) | We authored the fixtures and the lesson; they cite public documentation; to our knowledge they infringe no third-party copyright. Full indemnity offer possible. | We wrote every byte; sources are docs. |
| **Wild** (`wild`) | We authored the fixtures and lesson; the provenance is a *reference* to public source we do not redistribute; the SHA-256 pointer is accurate as of capture. **No warranty over the upstream repo's own license** — the buyer fetches that source under its terms. | We ship no third-party code; only a pointer + hash. |

This is the whole reason for the by-reference model: it lets us **truthfully sign a
rights warranty** on the wild tier, which we could not do if we embedded the
verbatim line.

## Contributor / supply-side rights

- Every fleet/community-submitted VTI carries `consentScope` (`opt-in:train` /
  `opt-in:train+eval`) — the **contributor's** consent to license their authored
  fixtures + finding through Brainblast. Keep this immutable and auditable.
- Contributors grant Brainblast a non-exclusive, sublicensable license to the
  artifacts they author; they retain no claim over buyers' trained models.
- **Consent ≠ upstream-repo copyright.** A contributor cannot consent away a third
  party's rights — which is exactly why the wild tier ships by reference, not by copy.

## Prohibited / carve-outs

- No resale/redistribution of the raw corpus. No sublicensing the dataset itself.
- No use to build a competing footgun-dataset product from the raw records (models trained are fine).
- Buyer indemnifies Brainblast for the buyer's own use of any upstream source it chooses to fetch.

## Open questions flagged for counsel (do not ship external without these)

1. Does the by-reference model (pointer + hash, no verbatim line) adequately
   insulate us from the upstream repos' licenses? (Our position: we redistribute
   nothing copyrightable; the pointer is a fact/URL.)
2. Copyleft repos (GPL/AGPL) in the wild set — even by reference, do we want to
   **exclude** them from sold lots to be safe? (Recommendation: add a
   `provenance.upstreamLicense` field via a license-detection pass and **exclude
   GPL/AGPL-sourced wild records from Commercial AI License lots** until cleared.)
3. Is the authored `fixed` fixture ever close enough to the upstream to be a
   derivative work? (Mitigated by the validator's token-span check in CLEANROOM-SPEC.)
4. Warranty/indemnity caps per SKU.
5. EU DB-rights / sui generis database right on the *compilation* — likely ours
   (we curated + proved), confirm.

## Next artifact

A **license-detection pass** over wild records (`provenance.upstreamLicense`) so we
can filter sold lots by upstream license and satisfy Q2 above. Small addition to
the reprove job (it already fetches each commit).
