# Corpus SLA — Brainblast Verified Traps

_Generated 2026-07-01T20:06:16.967Z by corpus-sla@0.1.0. Source of truth: `datasets/sla.json`._

## Headline
- **Reproduction rate: 100.0%** (13/13 verifiable VTIs still go RED→GREEN).
- **Schema-valid: 100.0%** (13/13).
- **Packaging:** v0.1.0 full lot matches seed.
- **Integrity gate:** ✅ PASS.

## Per-lot
| lot | total | schema-valid | reproduced | unverifiable | age median (d) | age max (d) |
|---|---|---|---|---|---|---|
| synthetic-owned | 13 | 13 | 13 | 0 | 0 | 0 |

_No failures._

## Notes
- **Reproduction** is the freshness/decay signal: a trap that stops reproducing
  means the SDK moved under it (re-research needed) or the data was tampered.
- "Median age from SDK release to VTI" (the sharper freshness metric) needs SDK
  release dates as an input — a Stage 3 follow-up; today's age is since capture.
- `unverifiable` = the trap's rule isn't resolvable locally (e.g. a contributed
  trap from a pack not installed); not counted against the reproduction rate.
