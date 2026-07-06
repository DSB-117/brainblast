---
name: brainblast-fleet
description: Autonomously source verified SDK-footgun VTIs — sweep seams, prove RED→GREEN, submit to the registry, and run on a cron.
version: 0.1.0
author: Brainblast
license: MIT
metadata:
  hermes:
    tags: [blueprint, security, automation, vti, sourcing]
    requires_toolsets: [terminal]
    blueprint:
      schedule: "0 */6 * * *"
      deliver: origin
      prompt: "Run one brainblast fleet cycle: execute the bundled run-fleet.sh via the terminal tool, then report the scoreboard (proven vs drafted, corpus delta, rejects)."
      no_agent: false
required_environment_variables:
  - name: BRAINBLAST_INGEST_TOKEN
    prompt: "Brainblast operator ingest token (optional)"
    help: "Bypasses the per-IP submit cap on the open registry. The server still gates every submission on provenance + reproof. Leave blank if you don't have one."
    required_for: "uncapped bulk submission"
---

# Brainblast Fleet (Hermes)

Autonomous VTI sourcing for Hermes. A **VTI** (Verified Trap Instance) is a real,
RED→GREEN-proven SDK footgun mined from public code — an insecure-default flag, a
zeroed fee, a skipped verification. This skill grows the brainblast corpus at
[registry.brainblast.tech](https://registry.brainblast.tech) without supervision.

**The non-negotiable invariant:** only traps that prove RED→GREEN through the
real checkers ever land. The deterministic engine proves; you orchestrate. Never
hand-edit a fixture to force a pass — a non-reproducing candidate is a DRAFT,
full stop.

This is a **blueprint**: it carries a schedule, so installing it offers a
recurring fleet run you accept via `/suggestions`. It also runs on demand.

## When to Use

- The user says "run the fleet", "source VTIs", "grow the corpus", or "scout SDKs".
- The blueprint's scheduled cron fires (every 6h by default).

## Quick Reference

| Action | Command |
| --- | --- |
| List available seams | `${HERMES_SKILL_DIR}/scripts/run-fleet.sh --list` |
| Run a full cycle (all seams) | `${HERMES_SKILL_DIR}/scripts/run-fleet.sh` |
| Run specific seams | `${HERMES_SKILL_DIR}/scripts/run-fleet.sh objarg absence cstsol` |
| Install the deterministic cron | `${HERMES_SKILL_DIR}/scripts/install-cron.sh` |

## Procedure

Run one deterministic cycle with the `terminal` tool:

```bash
${HERMES_SKILL_DIR}/scripts/run-fleet.sh
```

The script clones/updates a **managed** engine checkout itself, needs no GitHub
quota, holds a single-run lock, and gates every step. It stops at the first red
gate:

0. **Reset** — the managed clone is reset to its committed baseline (guarded by a
   sentinel so it never touches a repo it didn't clone), keeping `packs/` and
   `candidates/` bounded so prove/SLA never creep past the cron timeout.
1. **Discover** — `sg_scout.py` sweeps Sourcegraph seams and writes candidate
   findings with commit-pinned provenance (repo + SHA + verbatim line).
2. **Prove + promote** — `npm run fleet` proves each candidate RED→GREEN and
   promotes the proven into `packs/`. **The absolute gate** — non-reproducing
   candidates are DRAFT and never advance.
3. **SLA gate** — `npm run sla` must be green (whole corpus reproduces) or the
   script aborts before any submit.
4. **Submit** — only the **newly-proven** candidates POST to the open `/api/vti`
   (scoped so the registry's 60/hr per-IP cap is spent on new work, not on
   re-POSTing the committed corpus). The server re-proves each and rejects
   anything without fetchable provenance. Idempotent.
5. **Reprove (optional)** — `BRAINBLAST_REPROVE=1` + token flips new VTIs to
   `proof_verified=true` now; the registry also reproves on its own schedule.

Read the scoreboard it prints and report: seams swept, proven vs drafted, corpus
delta, any REJECT lines.

### Deepening with subagents (optional, for richer footguns)

The seam sweep is broad but shape-bounded. To find *novel* footguns, fan out
`delegate_task` subagents — up to 3 in parallel — one per target repo. Subagents
know nothing about this conversation, so pass the full contract in `context`:

```
delegate_task(tasks=[
  {"goal": "Scout owner/repo for a silent <sdk> integration footgun",
   "context": "Find code where the happy path compiles but does the wrong thing "
     "(insecure-default flag, zeroed fee, skipped verification, wrong constant). "
     "Shallow-clone read-only. For each real footgun fitting an existing checker "
     "(object-arg-property-forbidden-literal is the workhorse), write a candidate to "
     "$BRAINBLAST_REPO/fleet/candidates/<id>.json per fleet/SCOUT-CONTRACT.md with "
     "COMMIT-PINNED provenance: git rev-parse HEAD, sourceRef = "
     "github.com/owner/repo/blob/<sha>/<path>, evidence = the verbatim vulnerable "
     "line (MUST contain the trap's propName/call). Self-validate with "
     "'npm run submit:vti -- --candidate <abs> --dry-run --verify-provenance'. "
     "Do NOT fabricate — if there's no provable footgun, write nothing and say clean.",
   "toolsets": ["terminal", "file"]}
])
```

Then drive the engine directly — **not** `run-fleet.sh`, whose managed-clone
reset would wipe the subagents' candidates. From `$BRAINBLAST_REPO/packages/core`:

```bash
npm run fleet                                   # prove RED→GREEN + promote (the gate)
npm run sla                                     # corpus must be green
npm run submit:vti -- --candidate fleet/candidates/<id>.json   # per proven candidate
```

Keep them cheap via `delegation.model` (a smaller model) — the proof gate, not
the model, decides what lands. Subagents read code; they never execute a scouted
repo's scripts.

## Autonomous cron

Two options:

- **Blueprint (agent-in-loop):** accept the scheduled suggestion — `/suggestions`,
  then `/suggestions accept <n>`. The cron wakes a fresh session that loads this
  skill and runs the prompt; the agent can also deepen with subagents.
- **No-agent (pure deterministic):** `${HERMES_SKILL_DIR}/scripts/install-cron.sh`
  copies the pipeline into `~/.hermes/scripts/` and creates a `--no-agent
  --script` job. Zero LLM: the scheduler runs the script and delivers its
  stdout. An unattended run can only ever submit proof-gated VTIs.

Manage either with the standard verbs: `hermes cron list`, `hermes cron run
brainblast-fleet`, `hermes cron remove brainblast-fleet`. (Cron sessions can't
create more cron jobs, by design.)

## Pitfalls

- **Provenance is mandatory.** A candidate whose evidence line doesn't literally
  contain the trap's `propName`/`call` at the pinned commit is rejected. This is
  the #1 rejection cause — see `fleet/SCOUT-CONTRACT.md`.
- **Never force a red gate.** If prove or SLA is red, stop and report verbatim.
- **`BRAINBLAST_REPO` is a managed clone** (default `~/.brainblast/repo`) — the
  script resets it to the committed baseline each run, so never point it at a
  repo you are working in. It only resets clones it created (sentinel-guarded).
- **First run is the slow one** (clone + `npm ci`). If the no-agent cron script
  times out, raise `HERMES_CRON_SCRIPT_TIMEOUT` / `cron.script_timeout_seconds`.
- **Reprove needs a token.** `BRAINBLAST_REPROVE=1` only accelerates flipping
  `proof_verified` when `BRAINBLAST_REPROVE_TOKEN` is set; otherwise the registry
  reproves on its own ~30-min schedule.

## Verification

A cycle succeeded if the scoreboard shows proven candidates promoted and the
submit line reads `landed=N` (or `duplicate=N` on a re-run) with `rejected=0`,
and `npm run sla` was green. Per-run detail: `$BRAINBLAST_REPO/fleet/REPORT.md`.
