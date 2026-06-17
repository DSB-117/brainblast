# `npx brainblast` — catching the Bags zero-fee trap

This is the smallest possible repro of the **Enforce** half of brainblast: no setup, no research
run, no LLM — just a static scan that catches a silent, permanent, zero-revenue misconfiguration
before it ships.

[`src/feeconfig.ts`](src/feeconfig.ts) is exactly the kind of code an AI agent writes when it knows
the [Bags](https://bags.fm) SDK shape but not the trap documented in
[`examples/bags-api/final-report.md`](../bags-api/final-report.md): it builds a valid fee-share
config — the BPS sum to 10,000, the call compiles, the launch would succeed — but it never adds the
**creator's own wallet** to `feeClaimers`. The token launches, the creator earns 0% of all trading
fees, permanently, with no way to fix it after deploy (the config is immutable on-chain).

## Run it

From this directory:

```sh
npx brainblast .
```

## What you get

```
brainblast: scanned . with 3 rule(s)
  [FAIL ] bags-fee-share-creator-included  src/feeconfig.ts:8
          The creator wallet is not in feeClaimers. The creator must be an explicit entry —
          omitting them does NOT default them to any share; they earn zero fees forever, and
          the fee config is immutable on-chain after launch.
  verdict: blocked  (fail=1, cant_tell=0)
  report:  .agent-research/report.json
```

Exit code `1` — wired into `--ci` mode and [`scripts/brainblast-gate.sh`](../../scripts/brainblast-gate.sh),
this is what blocks the merge.

## The fix

Add the creator's wallet to `feeClaimers` with a non-zero `userBps`, keeping the total at 10,000:

```ts
const feeClaimers = [
  { user: creatorWallet, userBps: 5000 },
  { user: "Partner1Wa11et11111111111111111111111111111", userBps: 3000 },
  { user: "Partner2Wa11et22222222222222222222222222222", userBps: 2000 },
];
```

Re-run `npx brainblast .` and the check now passes. Brainblast can also generate a durable
behavioral-contract test for this exact trap — see [`packages/core`](../../packages/core/) and the
proven fixtures at [`packages/core/fixtures/bags/`](../../packages/core/fixtures/bags/).

## Where this trap was first predicted

This isn't a contrived example — it's the headline finding from a real `/brainblast` research run
against Bags requirements, documented end-to-end in [`examples/bags-api/`](../bags-api/). The CLI
you just ran enforces, in CI, the exact failure mode the research skill predicted before any code
was written. Same trap, same `report.json` contract, two moments in the lifecycle.
