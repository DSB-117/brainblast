---
name: brainblast-fleet
description: Autonomously source verified SDK-footgun VTIs — sweep seams, prove RED→GREEN, submit to the registry, and run on a cron.
version: 0.1.0
emoji: "🦞"
homepage: https://registry.brainblast.tech
metadata:
  openclaw:
    requires:
      bins: [git, node, npm, python3]
    primaryEnv: BRAINBLAST_INGEST_TOKEN
    envVars:
      - name: BRAINBLAST_INGEST_TOKEN
        required: false
        description: Operator bearer token — bypasses the 60/hr per-IP submit cap on the open registry. Optional; the server still gates every submission on provenance + reproof.
      - name: BRAINBLAST_REPO
        required: false
        description: Managed checkout dir for the engine repo (default ~/.brainblast/repo). The skill clones it and resets it to the committed baseline each run — do NOT point it at a repo you are working in.
      - name: BRAINBLAST_REPROVE
        required: false
        description: Set to 1 to run `npm run reprove` after each batch so new VTIs flip proof_verified=true immediately (the registry also reproves on its own ~30-min schedule).
      - name: BRAINBLAST_REPROVE_TOKEN
        required: false
        description: Shared secret required by `npm run reprove` (only needed when BRAINBLAST_REPROVE=1).
---

# Brainblast Fleet (OpenClaw)

Autonomous VTI sourcing for OpenClaw. A **VTI** (Verified Trap Instance) is a
real, RED→GREEN-proven SDK footgun mined from public code — an insecure-default
flag, a zeroed fee, a skipped verification. This skill grows the brainblast
corpus at [registry.brainblast.tech](https://registry.brainblast.tech) without
supervision.

**The non-negotiable invariant:** only traps that prove RED→GREEN through the
real checkers ever land. The deterministic engine proves; you orchestrate. You
never hand-edit a fixture to force a pass — a non-reproducing candidate is a
DRAFT, full stop.

The heavy lifting is one bundled script, `{baseDir}/scripts/run-fleet.sh`, which
runs a whole cycle deterministically: sweep → prove (gate) → SLA (gate) → submit
only the newly-proven. It clones/updates a **managed** engine checkout itself
(resetting it to the committed baseline each run so cost stays bounded), needs no
GitHub quota, holds a single-run lock, and is safe to run unattended. Your job is
to pick seams, run it, read the scoreboard, optionally deepen with sub-agents,
and report.

## When to use

- The user says "run the fleet", "source VTIs", "grow the corpus", or "scout SDKs".
- A cron fires the scheduled job this skill installs (see **Autonomous cron** below).

## Quick start (one cycle)

Run the full deterministic cycle with the `exec` tool:

```bash
{baseDir}/scripts/run-fleet.sh
```

That sweeps every seam. To target specific seams, pass them (`--list` shows the
menu without doing work):

```bash
{baseDir}/scripts/run-fleet.sh --list
{baseDir}/scripts/run-fleet.sh objarg absence cstsol
```

Read the scoreboard it prints: proven-and-promoted vs drafted counts, corpus
delta, and any REJECT lines from the registry. Report those numbers back.

## Phases (what the script gates, so you can reason about failures)

0. **Reset** — the managed clone is reset to its committed baseline (guarded by
   a sentinel so it never touches a repo it didn't clone), keeping `packs/` and
   `candidates/` bounded so prove/SLA never creep past the cron timeout.
1. **Discover** — `sg_scout.py` sweeps Sourcegraph seams and writes
   `fleet/candidates/*.json`. Each hit carries commit-pinned provenance (repo +
   SHA + verbatim line), which the registry requires.
2. **Prove + promote** — `npm run fleet` proves every candidate RED→GREEN and
   auto-promotes the proven into `packs/`. **This is the absolute gate.**
   Candidates that don't reproduce are DRAFT and never advance.
3. **SLA gate** — `npm run sla` must be green (100% of the corpus reproduces)
   or the script aborts before any submit.
4. **Submit** — only the **newly-proven** candidates are POSTed to the open
   `/api/vti` (scoped so the registry's 60/hr per-IP cap is spent on new work,
   not on re-POSTing the committed corpus). The server **re-proves each one**
   and rejects anything without fetchable provenance. Idempotent.
5. **Reprove (optional)** — with `BRAINBLAST_REPROVE=1` + token, flips new VTIs
   to `proof_verified=true` now; the registry also reproves on its own schedule.

If any gate is red, the script stops. Report the failure verbatim — do not try
to force it through.

## Deepening with sub-agents (optional, for richer footguns)

The seam sweep is broad but shape-bounded. To find *novel* footguns a seam
doesn't cover, fan out isolated sub-agents with `sessions_spawn`, one per target
repo, then `sessions_yield` to collect them. Give each EXACTLY this contract:

> Scout `<owner/repo>` for a **silent integration footgun** in its use of
> `<sdk>`: code where the happy path compiles and runs but does the wrong thing
> (insecure-default flag, zeroed fee/amount, skipped verification, wrong
> constant). Shallow-clone read-only (`git clone --depth 1`). For each real
> footgun that fits an existing checker (`object-arg-property-forbidden-literal`
> is the workhorse), write a candidate to `$BRAINBLAST_REPO/fleet/candidates/<id>.json`
> per `$BRAINBLAST_REPO/fleet/SCOUT-CONTRACT.md`. Capture COMMIT-PINNED
> provenance: the exact `git rev-parse HEAD`, `provenance.sourceRef` =
> `github.com/<owner>/<repo>/blob/<sha>/<path>`, `provenance.evidence` = the
> verbatim vulnerable line (it MUST contain the trap's `propName`/`call`).
> Self-validate with `npm run submit:vti -- --candidate <abs> --dry-run
> --verify-provenance` before returning. **Do not fabricate** — if the repo has
> no provable footgun, write nothing and report "clean".

Deepening drives the engine directly — **not** `run-fleet.sh`, whose managed-clone
reset would wipe the sub-agents' candidates. After the sub-agents write to
`$BRAINBLAST_REPO/fleet/candidates/`, from `$BRAINBLAST_REPO/packages/core` run:

```bash
npm run fleet                                   # prove RED→GREEN + promote (the gate)
npm run sla                                     # corpus must be green
npm run submit:vti -- --candidate fleet/candidates/<id>.json   # per proven candidate
```

Keep sub-agents cheap: set `agents.defaults.subagents.model` to a smaller model —
the proof gate, not the model, decides what lands.

Sub-agents read code; they never execute a scouted repo's scripts. Clone
`--depth 1`, read-only.

## Autonomous cron

Install a recurring job that runs a cycle on its own. `{baseDir}/scripts/install-cron.sh`
wraps `openclaw cron create` with sane defaults (every 6 hours, command payload,
no model call):

```bash
{baseDir}/scripts/install-cron.sh                 # every 6h
{baseDir}/scripts/install-cron.sh "0 */12 * * *"  # custom cron expression
```

Inspect and manage it with the standard cron verbs:

```bash
openclaw cron list
openclaw cron runs --id <job-id>
openclaw cron remove brainblast-fleet
```

The job runs `run-fleet.sh` as an isolated **command** payload — no model call,
pure deterministic pipeline — so an unattended run can only ever submit
proof-gated VTIs. (Cron sessions can't spawn more cron jobs, by design.) Use the
sub-agent deepening path in interactive runs where a model is in the loop.

## Report

Summarize: seams swept, candidates proven vs drafted, corpus delta, any
rejects, and suggested next seams. Per-run detail is in
`$BRAINBLAST_REPO/fleet/REPORT.md`.
