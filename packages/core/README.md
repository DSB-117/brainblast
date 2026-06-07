# @brainblast/core (T3)

The shared engine, extracted from the T1 (Stripe) and T2 (Privy/JWT) spikes once
two structurally different traps existed (eng review D9). One `brainblast <dir>`
now runs every bundled rule.

## Shape

```
detect ──► check ──► emit report.json
   │         │              │
 finder   checker      + generate behavioral
 (rule.   template     contract test
  detect) (rule.check  (rule.test.kind)
          .kind)
```

- **Skeleton (shared):** `walk`, `finder`, `audit`, `emit`, `cli`, `--ci` gate.
- **Rules are PURE DATA** — `rules/*.yaml` (facts.yaml), loaded and validated at
  runtime by `src/loadRules.ts`: id, severity, component, `detect` facts, and a
  `check.kind` + `test.kind` that bind to vetted templates. No executable code in
  a rule; the loader rejects a rule that binds to an unknown kind or has an
  invalid regex (the safety net for agent-authored rules, T9).
- **Vetted templates (human-maintained, in core):**
  - checkers: `positional-arg-identity` (T1), `required-call-with-options` (T2)
  - tests: `stripe-webhook-signature` (T1), `privy-jwt-claims` (T2)

Adding a trap that fits an existing template kind = a new `rules/*.yaml` file,
zero engine changes. A genuinely new shape = one new vetted template, then data.

## Run

```sh
npm install
npm run prove                         # matrix: 4 cases, RED/GREEN through the engine
npm run audit -- fixtures/stripe/vulnerable --ci   # exit 1
npm run audit -- fixtures/jwt/fixed --ci           # exit 0
```

`prove` also asserts each fixture raises exactly one (correct) check — the
unified engine does not cross-contaminate Stripe and JWT traps.
