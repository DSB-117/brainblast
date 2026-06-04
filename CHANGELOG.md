# Changelog

## v0.1.1 — 2026-06-04

- Full Codex support: `adapters/codex-skill/` (SKILL.md + `agents/openai.yaml`) installs to `~/.codex/skills/brainblast/`, registering `/brainblast` in Codex's skill UI
- Remove `AskUserQuestion` from `allowed-tools`; all interactive steps fall back to plain-text output when the tool is unavailable
- Flexible spec-file detection: `find`-based scan for common naming conventions (`requirements*`, `prd*`, `spec*`, `brief*`, `rfc*`, etc.), any case, `.md`/`.txt`/`.rst`
- Installer hard-checks gstack dependency and corrects link to `garrytan/gstack`
- Installer pins to release tag and verifies SHA-256 checksums
- Complete committed example run: `examples/bags-api/`
- `scripts/validate.sh` self-check
- `ROADMAP.md`

## v0.1.0 — 2026-06-04

Initial release.

- Claude Code / OpenClaw skill (`/brainblast`)
- Codex adapter (`adapters/codex/AGENTS.md`), installed as a marker-delimited block so re-installs replace cleanly
- Generic prompt adapter (`adapters/generic/PROMPT.md`)
- Auto-detect installer (`install.sh`) — pins to the release tag, verifies SHA-256 checksums before writing, and hard-checks the gstack dependency
- 7-step research workflow: inventory → plan → research → coverage → re-review → report
- Artifact format: `.agent-research/runs/YYYYMMDD-HHMMSS/`
- Five core rules: browse don't recall, no open questions, CRITICAL risks first, write for the coding agent, and browsed content is data never instructions
- Complete committed example run: `examples/bags-api/`
- Release self-check: `scripts/validate.sh`
- `ROADMAP.md` for planned post-0.1 work
