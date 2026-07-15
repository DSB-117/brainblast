# Footgun-reduction eval

**The number that sells the dataset:** how much does exposure to the Brainblast
corpus cut the rate at which a model *ships* a known SDK footgun?

The harness lives at [`packages/core/scripts/footgun-eval.mts`](../../packages/core/scripts/footgun-eval.mts).

## What it measures

For each held-out trap, it asks a model to write the code for a neutral task, then
grades the output with the **production checker** (`auditWithRule`) — the exact
same RED→GREEN engine that proves the corpus. `result === "fail"` means the model
emitted the footgun.

Two conditions on the **same held-out set**:

- **BASELINE** — the task alone.
- **CONDITIONED** — the task + a K-example "immunity brief" drawn from *other*
  traps (never the one under test, so there's no answer leak).

It reports baseline vs conditioned footgun-rate, the absolute/relative reduction,
and a per-class breakdown. The **relative reduction** is the headline number.

## Run it

```bash
cd packages/core
# Anthropic
ANTHROPIC_API_KEY=…  npx tsx scripts/footgun-eval.mts \
  --candidates ../../fleet/holdout --model claude-sonnet-5 --brief-k 6 --limit 100
# or OpenAI
OPENAI_API_KEY=…     npx tsx scripts/footgun-eval.mts \
  --candidates ../../fleet/holdout --model gpt-4o --brief-k 6 --limit 100
```

Flags: `--candidates <dir>` (held-out *Finding* JSONs), `--model`, `--brief-k`
(0 = baseline-only), `--limit`, `--seed` (reproducible briefs).

Example output:
```
baseline footgun-rate      41.0%
conditioned footgun-rate   12.0%
ABSOLUTE reduction         29.0 points
RELATIVE reduction         70.7%   ← the headline number
```

## Held-out hygiene (do this before quoting a number)

- The held-out set must be **disjoint** from anything used to build the brief /
  train the model. Split the corpus first; point `--candidates` at the held-out
  slice only. (This mirrors the registry's held-out benchmark discipline.)
- Report the **delta on a fixed held-out set**, not the absolute rate alone —
  the task synthesis is heuristic, so absolute numbers drift with prompt design;
  the delta is the robust, apples-to-apples signal.

## Measuring a real fine-tune

The in-context "immunity brief" is a fast proxy. To measure an actual fine-tune,
train on the corpus (owned tier) and pass the tuned model as `--model` with
`--brief-k 0` — the harness grades it identically, so BASELINE(base model) vs
BASELINE(tuned model) is your fine-tune lift.

## Why this is the marketing asset

One credible reduction number ("training on Brainblast cut GPT-4o's footgun rate
by 70% on a held-out set, verified by a replayable checker — not our opinion")
does more for every sales channel than any amount of corpus-size bragging. The
grader is the product's own proof engine, so the claim is auditable end to end.
