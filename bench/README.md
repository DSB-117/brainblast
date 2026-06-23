# Brainblast Trap Benchmark

**Does a model avoid silent SDK-integration traps on current APIs?**

The eval wedge of [`ROADMAP-TRAINING-DATA.md`](../ROADMAP-TRAINING-DATA.md)
(Stage 1, Step 3). Each [Verified Trap Instance](../datasets/seed/README.md) is
one eval item. A model is asked to implement a function against a real SDK; we
grade whether the result ships the trap or avoids it.

## The oracle (why this is trustworthy)

Grading is **not** a string match or an LLM judge. It is Brainblast's own static
checker, run via `auditWithRule` over the candidate code:

| Checker result on candidate | Meaning | Score |
|---|---|---|
| **fail** (RED) | the model shipped the trap | ❌ 0 |
| no fail (GREEN, incl. `cant_tell`) | the model avoided the trap | ✅ 1 |

This is the *same* RED→GREEN gate that proves the dataset, so the benchmark is
**reward-gradable and fully reproducible** — there is no secret answer key (the
trap rules ship in the npm package). Anti-gaming comes from **freshness**: new
traps keep entering as `brainblast-scout` runs (Stage 3), not from secrecy.

## Usage

```sh
cd packages/core

# Prove the oracle end-to-end (no model needed):
#   vulnerable fixtures must score 0% avoided, fixed fixtures 100%.
npm run bench                        # default: --self-test

# Publish the task set a model fills in (writes tasks.jsonl + leak-free starters).
npm run bench -- --emit-tasks bench/tasks

# Grade model outputs laid out as <submissions>/<trapId>/<file>.
npm run bench -- --submissions /path/to/submissions --out bench/results
```

A submission scores **100%** only if it avoids every trap; `--submissions` exits
non-zero below 100% so it can gate CI.

## Layout

- `tasks/tasks.jsonl` — one public task per proven trap (sdk, severity, doc URL, prompt).
- `tasks/starters/<trapId>/` — starter stubs (imports + signature only; the fix is never leaked).
- `results/` — per-run scorecards (git-ignored).

## $BRAIN

The benchmark itself is open and reproducible. The commercial surfaces around it
settle in `$BRAIN`:
- **Private/held-out eval suites** (Stage 5) are sold to labs, priced in USD and
  payable in `$BRAIN` at a discount (USDC → buyback).
- A **public leaderboard** requires a `$BRAIN` **stake** to submit a scored run —
  slashable if the run can't be reproduced from the published artifacts. Same
  stake-and-slash integrity primitive as the pack registry.
