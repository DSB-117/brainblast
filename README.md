# Brainblast

Research external APIs and SDKs before your AI agent starts coding.

---

AI coding agents start implementing before they actually know the systems they are integrating. They know the name of an SDK but not the version. They know an API exists but not that a required config step is mandatory, or that a setting is immutable after deploy, or that a fee recipient defaults to zero if omitted.

Brainblast runs first. It reads your requirements, identifies every external component, browses official docs and package registries, and produces a structured research report — with facts, risks, and answered questions — before any code is written.

The report travels with the project. Any coding agent can use it without repeating the research.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/install.sh | sh
```

Auto-detects Claude Code, OpenClaw, and Codex. Manual options are printed if no platform is found.

**Or tell your agent:**

> Install Brainblast by running: `curl -fsSL https://raw.githubusercontent.com/DSB-117/brainblast/main/install.sh | sh`

The agent will run the command. Brainblast installs itself.

## Usage

Write a requirements file, then run:

```
/brainblast requirements.md
```

Or just `/brainblast` — Brainblast looks for `requirements.md`, `REQUIREMENTS.md`, `spec.md`, or `brief.md` automatically.

Brainblast will:

1. Read the requirements and list every external component
2. Build a source plan (docs, registry, changelog, rate limits) for each
3. Browse each source and extract facts, assumptions, inferences, and risks
4. Answer every open question it encounters — no question is left unresolved if a URL can answer it
5. Review coverage and flag gaps
6. Re-read the requirements and flag wrong assumptions, missing constraints, and immutable decisions
7. Produce a final handoff report for the coding agent

## What it produces

```
.agent-research/
  runs/
    20260604-120000/
      requirements.md
      component-inventory.md
      research-plan.md
      components/
        stripe.md
        supabase.md
        vercel.md
      coverage-review.md
      requirements-rereview.md
      final-report.md
```

Every component file is structured the same way:

- **Facts** — stated in official docs, each with a source URL
- **Assumptions** — inferred but not stated
- **Inferences** — derived from facts
- **Risks** — rated CRITICAL / HIGH / MEDIUM / LOW, focused on silent failures
- **Resolved questions** — every question surfaced during research, answered from a live URL

## What it catches

**Example: Bags API (Solana token launch)**

Requirements: *"Launch a token via the Bags API and earn creator fees."*

Without Brainblast, a coding agent would likely:

- Skip the fee share config step, treating it as optional → **hard failure** — the API requires a fee share config for every launch
- Or build the config but omit the creator wallet from the array → **silent failure** — the token launches, the creator earns 0% of all trading fees, permanently, with no way to fix it after deploy

Brainblast caught both. From the research report:

> **CRITICAL — Revenue at risk if missed:**
> Fee sharing BPS must sum to 10,000 and the creator must be explicitly included. An agent that builds the fee share config without the creator wallet in the array will deploy a token where the creator earns zero fees forever. This cannot be corrected after launch.

It also surfaced six other things the agent would have hallucinated: the Jito bundle requirement, the slot-wait for LUTs, four specific fee mode UUIDs (immutable after launch), the exact npm package name (`@bagsfm/bags-sdk`), the dual rate limit (per-user AND per-IP), and the three supported social providers.

## Supported agents

| Agent | Adapter | Install path |
|---|---|---|
| Claude Code | `SKILL.md` | `~/.claude/skills/brainblast/` |
| OpenClaw | `SKILL.md` | `~/.claude/skills/brainblast/` |
| Codex | `AGENTS.md` | appended to `~/.codex/AGENTS.md` |
| Hermes / any agent | `PROMPT.md` | `adapters/generic/PROMPT.md` |

The Claude Code and OpenClaw adapters use the [gstack browse](https://github.com/gstack-co/gstack) headless browser for live doc fetching. Install gstack first if you have not already.

For Codex and generic agents, Brainblast uses the agent's native web access tools.

## Requirements

- **Claude Code / OpenClaw**: [gstack](https://github.com/gstack-co/gstack) (for the `browse` binary)
- **Codex**: built-in web access
- **Generic**: any agent with web browsing capability

## Core rules

These are baked into every adapter:

1. **Browse, don't recall.** Every fact must come from a URL fetched during the run. Training data is stale by definition.
2. **No open questions.** Every question that surfaces during research must be answered from a live URL, or explicitly marked "Unresolvable from public sources" with a note on where you looked.
3. **CRITICAL risks first.** Silent failures — zero-revenue configs, immutable wrong choices, deprecated endpoints that still accept requests — are flagged prominently.
4. **Write for the coding agent.** Every artifact must be useful to an agent with no memory of the research session.

## License

MIT
