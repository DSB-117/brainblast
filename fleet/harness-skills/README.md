# Brainblast fleet — harness skills

Native, publishable **agent skills** that run the brainblast VTI-sourcing fleet
autonomously — with built-in cron — on two agent harnesses besides Claude Code:

| Harness | Skill | Cron primitive | Fan-out primitive |
| --- | --- | --- | --- |
| [OpenClaw](https://docs.openclaw.ai) | [`openclaw/brainblast-fleet`](openclaw/brainblast-fleet/SKILL.md) | `openclaw cron` (isolated command job) | `sessions_spawn` |
| [Hermes](https://hermes-agent.nousresearch.com/docs) | [`hermes/brainblast-fleet`](hermes/brainblast-fleet/SKILL.md) | `hermes cron --no-agent --script` + blueprint | `delegate_task` |

Both are the same idea ported to each harness's own `SKILL.md` format: pick
seams → prove RED→GREEN → submit → run on a schedule. They complement the
Claude Code skill at [`.claude/skills/brainblast-fleet`](../../.claude/skills/brainblast-fleet/SKILL.md);
they don't replace it.

## The shared engine

Every skill drives one harness-agnostic pipeline, [`shared/run-fleet.sh`](shared/run-fleet.sh),
vendored into each skill's `scripts/` so the bundles publish standalone (to
ClawHub / the Skills Hub). It runs a whole cycle deterministically and gates
every step:

```
reset managed clone → committed baseline   (bounds cost; sentinel-guarded)
  → sweep seams (Sourcegraph, zero GitHub quota)
  → prove RED→GREEN + promote               [ABSOLUTE GATE]
  → corpus SLA green?                        [GATE — aborts before any submit]
  → submit ONLY newly-proven candidates      (server re-proves; respects 60/hr cap)
  → reprove (optional, token)
```

It holds a single-run lock (overlapping ticks can't corrupt the clone), hardens
`PATH` for minimal cron shells, and submits a scoped batch so the registry's
per-IP submit cap is never wasted re-POSTing the committed corpus.

Because the sweep and the gates are deterministic — no model needed — the same
script is safe to run unattended on a cron. The agent's role is to pick seams,
run it, read the scoreboard, optionally deepen with subagents, and report. The
proof gate, not the model, decides what lands. **Nothing is ever hand-edited to
force a pass.**

The script clones/updates the engine repo itself (`packages/core` +
`fleet/scripts`) on first run.

### Configuration (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `BRAINBLAST_REPO` | `~/.brainblast/repo` | **Managed** checkout — reset to the committed baseline each run. Don't point it at a repo you're working in (only fleet-created clones are reset; a sentinel guards this). |
| `BRAINBLAST_REPO_REMOTE` | `github.com/DSB-117/brainblast.git` | Engine git remote. |
| `BRAINBLAST_INGEST_TOKEN` | — | Operator token; bypasses the 60/hr per-IP submit cap. The server still gates on provenance + reproof. |
| `BRAINBLAST_REPROVE` | — | `1` runs `npm run reprove` after a batch (needs `BRAINBLAST_REPROVE_TOKEN`). |
| `BRAINBLAST_REPROVE_TOKEN` | — | Shared secret for `npm run reprove`. The registry also reproves on its own ~30-min schedule. |

## Install

**OpenClaw**
```bash
openclaw skills install <clawhub-slug>          # or copy openclaw/brainblast-fleet into ~/.openclaw/workspace/skills/
openclaw skills list                            # confirm it loaded
# then, from a session or CLI:
#   run once →  {baseDir}/scripts/run-fleet.sh
#   schedule →  {baseDir}/scripts/install-cron.sh          (every 6h, isolated command job)
```

**Hermes**
```bash
hermes skills install <hub-slug>                # or copy hermes/brainblast-fleet into skills/
# blueprint schedule → /suggestions, then /suggestions accept <n>   (agent-in-loop)
# pure deterministic → ${HERMES_SKILL_DIR}/scripts/install-cron.sh   (--no-agent --script job)
```

## Keeping the vendored pipeline in sync

`shared/run-fleet.sh` is the source of truth. After editing it:

```bash
cp shared/run-fleet.sh openclaw/brainblast-fleet/scripts/run-fleet.sh
cp shared/run-fleet.sh hermes/brainblast-fleet/scripts/run-fleet.sh
```

## Safety invariants

- Only RED→GREEN-proven traps land; a non-reproducing candidate is a DRAFT.
- A red prove/SLA gate aborts before anything is submitted.
- The managed-clone reset is **sentinel-guarded** — it only ever resets a checkout the fleet itself cloned, never a repo you point it at.
- A single-run lock prevents overlapping cron ticks from corrupting the clone.
- Subagents read code; they never execute a scouted repo's scripts (`--depth 1`, read-only).
- Cron sessions can't create more cron jobs (both harnesses block this) — no runaway scheduling.
