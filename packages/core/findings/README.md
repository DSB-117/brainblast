# findings/

Structured research outputs the synth pipeline (`scripts/synth-prove.ts`)
consumes. A Finding is **pure data** — never executable logic. It carries:

- the rule's facts (id, severity, title, component, detect)
- a **binding** to an existing vetted `check.kind` + `test.kind`
- a vulnerable / fixed fixture pair the proof step runs RED→GREEN against
- provenance (where the research came from)

## Workflow

```sh
# Re-derive the Bags rule from a Finding (Phase 0 known-answer test).
npm run synth -- findings/bags-known-answer.json
```

Exit codes:

- `0` — **PROVEN.** Staged rule fails on vulnerable, passes on fixed, with the
  existing vetted checker. Safe to promote to `rules/` + `fixtures/`.
- `2` — **DRAFT.** Binding's `check.kind`/`test.kind` isn't vetted yet, or the
  staged rule loaded but RED→GREEN didn't hold. Written to `drafts/<id>/` for
  human review. Never auto-promoted.
- `1` — failure (bad input, crash, etc.).

Why a separate `-synth` rule id for the known-answer Bags finding? So the
staged rule never collides with the production `bags-fee-share-creator-included`
rule when both are loaded, and so the known-answer regression test is visibly
distinct from the hand-built guardrail it re-derives.
