# Selling the corpus — monetization kit

Concrete artifacts for turning the VTI corpus into a sellable product across
channels. Read in this order:

1. **[CLEANROOM-SPEC.md](CLEANROOM-SPEC.md)** — the sellable record. Ships authored
   fixtures + proof + **provenance by reference** (pointer + SHA-256, never a
   verbatim third-party line). One `provenanceClass` flag splits the
   unrestricted-license *owned* tier from the by-reference *wild* tier. **← the unlock.**
2. **[DATA-LICENSE.md](DATA-LICENSE.md)** — the training-license SKUs (General /
   Commercial AI), the tiered rights warranty the clean-room split lets us honestly
   sign, contributor consent, and the open questions to route to counsel.
3. **[OPENDATABAY-PACKAGE.md](OPENDATABAY-PACKAGE.md)** — ready-to-fill listing kit
   for Opendatabay/Defined.ai: metadata, data dictionary, sample pack, pricing map,
   and the small export pipeline (`toCleanroom` → validate → NDJSON).
4. **[BRAIN-UTILITY.md](BRAIN-UTILITY.md)** — $BRAIN as the access/settlement/reward
   rail, with a bright line around the features that would make it look like a
   security.
5. **[bench/footgun-eval/](../../bench/footgun-eval/)** — the runnable harness that
   produces the one number that sells everything: how much training on the corpus
   cuts a model's footgun rate, graded by the production checker.
6. **[CHANNELS.md](CHANNELS.md)** — the full avenue matrix: every place to sell/scale
   the corpus (direct, Opendatabay, HF, AWS/Snowflake, Ocean, Sahara, Bittensor,
   Vana, eval-as-benchmark, metered API), how they layer, and the sequencing.
7. **[BITTENSOR.md](BITTENSOR.md)** — selling verified code-data as a Bittensor
   subnet: the checker *is* the validator. Design, cost gate, and a runnable scaffold
   in [`integrations/bittensor/`](../../integrations/bittensor/).
8. **[../../ROADMAP.md](../../ROADMAP.md)** — the unified product roadmap; the path to
   10,000+ VTIs is Lane 2 (Corpus & Fleet), with demand across Lanes 4–5.

## The sequence (what to actually do)

1. **Rights review + clean-room export.** Counsel signs off on the by-reference
   model (DATA-LICENSE open questions); build `toCleanroom()` + `cleanroom-validate`
   (CLEANROOM-SPEC) + a `provenance.upstreamLicense` detection pass.
2. **Run the eval** (bench/footgun-eval) → get the reduction number on a held-out slice.
3. **List the owned tier on Opendatabay** (OPENDATABAY-PACKAGE) — reach + legal credibility.
4. **Tighten $BRAIN** to the sanctioned functions (BRAIN-UTILITY); scrub price language.
5. **Phase 2 (post-revenue):** Vana DataDAO (work-weighted, not holder-weighted) /
   Ocean compute-to-data (sell access without shipping raw data).

## The through-line

The moat isn't the marketplace or the token — it's that this is the **only
code-training data with a machine-checkable RED→GREEN proof.** Lead every channel
with the eval number; fix the rights question so it sells without a cloud over the title.

> Status: strategy + specs. Not legal/financial advice — DATA-LICENSE.md and
> BRAIN-UTILITY.md both flag what must go to counsel before external launch.
