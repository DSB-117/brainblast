# T2 spike — Privy/JWT auth-bypass auditor

Second deterministic trap (after T1 Stripe). Structurally different on purpose:
this is about token CLAIM verification, not request-body handling. The two
spikes together are what T3 uses to extract the real `@brainblast/core`.

## What it does

1. **Finder** (`src/finder.ts`, ts-morph): locate token-verification functions.
2. **Check** (`src/check.ts`): rule `privy-jwt-verification` →
   - FAIL: token decoded without verifying the signature (auth bypass), or
     verified but missing aud/iss (cross-app token reuse).
   - PASS: signature verified AND both aud + iss asserted.
3. **Generate** (`src/generateTest.ts`): the durable artifact — a behavioral
   contract test that mints real ES256 tokens (via `jose`, mirroring Privy) and
   asserts the verifier rejects a bad signature, a wrong audience, and a wrong
   issuer.
4. **Emit** (`src/emit.ts`): `report.json` (schemaVersion "1.0" + `checks[]`).

## Run

```sh
npm install
npm run prove          # E2E: RED on vulnerable (decode-only), GREEN on fixed
npm run audit -- fixtures/vulnerable --ci   # exit 1
npm run audit -- fixtures/fixed --ci        # exit 0
```

## Why it differs from T1 (the signal for T3)

T1 checks one positional argument of a single call (`constructEvent(rawBody,...)`).
T2 checks for an *absent* verify call (decode-only) and for *named option
properties* (`audience`/`issuer`) on a verify call. Same skeleton
(find → check → generate behavioral test → emit), different matchers. T3 keeps
the skeleton in core and pushes the per-trap matcher into a rule template.
