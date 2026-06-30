---
name: brainblast-fleet
version: 0.1.0
description: Autonomous VTI sourcing. Discovers popular repositories that depend on a target SDK, fans out a fleet of subagents to scout each one for silent footguns, proves every candidate RED→GREEN, auto-promotes the proven ones into the corpus, logs results to the shared ledger so other fleets skip them, and reports. Run it instead of hand-authoring candidates.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Agent
  - WebFetch
  - WebSearch
triggers:
  - run the fleet
  - brainblast fleet
  - scout repositories
  - source new VTIs
  - grow the corpus
---

# Brainblast Fleet

The autonomous successor to hand-dropping candidates. You (the orchestrating
agent) run this skill; it **fans out a fleet of subagents** — one per repository —
to do the scouting, then the deterministic engine proves, promotes, submits, and
logs. The model doing the reasoning is **whatever agent is running Brainblast**
(this one) — no API key is requested.

The non-negotiable invariant: **only traps that prove RED→GREEN through the
existing checkers ever land.** Subagents propose; `proveFinding` disposes.

Run from `packages/core/`. Five phases.

## Phase 0 — Pick targets

If the user named SDKs/protocols, use them. Otherwise read the work-orders the
last run left — `cat ../../fleet/REPORT.md` or `datasets/COVERAGE.md` — and target
the **uncovered classes** and **thin cells**, freshness-first (recently-shipped
or high-download SDKs, where models are most stale).

## Phase 1 — Discover (deterministic)

For each target SDK:

```bash
npm run fleet:discover -- --sdk <pkg> --limit 10 --min-stars 200
```

Writes `fleet/worklist.json` (popular dependent repos, ranked by stars, already
filtered against the shared ledger so you don't re-scout what another fleet did).
Read it. If it's empty, the ledger says everything popular here is already done —
pick another SDK.

## Phase 2 — Scout (fan out the subagent fleet)

For each repo in the worklist, **spawn a subagent** (the `Agent` tool,
`general-purpose`). Launch them in parallel batches (e.g. 3–5 at a time). Give
each subagent EXACTLY this contract:

> Scout `<owner/repo>` for a **silent integration footgun** in its use of
> `<sdk>`: code where the happy path compiles and runs but does the wrong thing
> (an insecure-default flag, a zeroed fee/amount, a skipped verification, a wrong
> constant). Shallow-clone read-only (`git clone --depth 1`) into a temp dir.
> For each real footgun you find that fits an existing brainblast checker
> (`object-arg-property-forbidden-literal` is the workhorse — an options-object
> property set to a forbidden string/number/boolean literal), write a candidate
> Finding to `fleet/candidates/<id>.json` following `fleet/README.md`. The
> `vulnerable` fixture must contain the forbidden value; the `fixed` fixture must
> set a safe literal (so it PASSES). Set `class`. **Do not fabricate** — if the
> repo has no provable footgun, write nothing and report "clean". Return: repo,
> the candidate ids you wrote (or "clean"), and a one-line note per finding.

Collect each subagent's report (repo → candidate ids / clean).

## Phase 3 — Prove + promote (deterministic gate)

```bash
npm run fleet
```

This proves every candidate RED→GREEN, **auto-promotes the proven** into `packs/`,
regenerates the corpus + storefront, and prints the scoreboard. Candidates that
don't reproduce are reported DRAFT and never land — that is the safety rail that
makes autonomous sourcing safe. Then confirm integrity:

```bash
npm run sla   # must be green (100% reproduce) before anything is submitted
```

## Phase 4 — Submit + log

**Submit (gated — never skip the gate).** Only after `npm run sla` is green AND
`npm run typecheck` passes, submit the newly-promoted VTIs:

```bash
git add packs/ datasets/ fleet/candidates/
git commit -m "fleet: <N> VTIs from <SDKs> (auto-sourced)"
```

Then, **per the operator's policy** (`BRAINBLAST_FLEET_PUSH`):
- unset / `branch` (default, recommended): push a `fleet/auto-<date>` branch and
  open a PR — automated but reviewable before the public corpus changes.
- `main`: the operator has authorized direct push — `git push origin HEAD:main`.

If any gate is red, **stop and report** — do not submit. The proof gate already
guarantees each VTI reproduces; this second gate guarantees the *whole corpus*
still does.

**Log to the shared ledger** so sibling fleets skip these repos:

```bash
npm run fleet:ledger -- --record fleet/worklist.json
```

Writes the registry's **open** `/api/fleet-ledger` (default
`registry.brainblast.tech` — no token, no key; the server validates the payload),
falling back to the local `fleet/ledger-cache.json` that discovery reads. Record
every scouted repo — clean ones too, so they're not re-scouted.

## Phase 5 — Report

Summarize: targets, repos scouted, candidates proven vs drafted, corpus delta,
newly-covered classes, and the next work-orders (from the scoreboard) for the
following run. Per-repo detail lives in `fleet/REPORT.md`.

---

**Honesty & safety**
- The proof gate is absolute: never promote or submit a VTI that didn't go
  RED→GREEN, and never hand-edit a fixture to force it. A non-reproducing
  candidate is a DRAFT, full stop.
- Subagents read code; they don't run untrusted code. Clone `--depth 1`,
  read-only, and never execute a scouted repo's scripts.
- The ledger prevents redundant work across fleets — always record at the end.
