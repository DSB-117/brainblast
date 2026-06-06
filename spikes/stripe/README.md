# T1 spike — Stripe webhook catastrophic-trap auditor

Deterministic, zero-LLM proof of the eng-reviewed architecture (design doc
`dsb-main-design-20260605-230234.md`). Throwaway internals on purpose — this
spike exists to derive the real `@brainblast/core` abstraction (T3), not to ship.

## What it does

1. **Finder** (`src/finder.ts`, ts-morph) locates Stripe webhook handlers in a repo.
2. **Check** (`src/check.ts`) decides PASS / FAIL / CANT_TELL for the rule
   `stripe-webhook-raw-body-verification`: is `stripe.webhooks.constructEvent`
   called on the **raw** body?
3. **Generate** (`src/generateTest.ts`) writes the durable artifact: a
   **behavioral contract test** that forges a webhook and asserts rejection
   (valid sig passes, invalid fails, mutated body fails). Not a re-run of the
   static check.
4. **Emit** (`src/emit.ts`) writes `report.json` (schemaVersion "1.0" + additive
   `checks[]` / `checkTotals`).

## Run

```sh
npm install
npm run prove          # E2E: RED on vulnerable fixture, GREEN on fixed
npm run audit -- fixtures/vulnerable --ci   # exit 1; writes .agent-research/spike-report.json
npm run audit -- fixtures/fixed --ci        # exit 0
```

## Maps to the eng review

- D1 deterministic, no LLM in the CLI. D3 AST via ts-morph. D4 CANT_TELL warns,
  does not fail `--ci`. **D8** the durable artifact is behavioral, not a static
  meta-test. **D9** spike first, extract `@brainblast/core` after the JWT trap.
