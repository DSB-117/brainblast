# Coverage Review

| Component | Auth | Install/version | Rate limits | Breaking changes | Risks |
|---|---|---|---|---|---|
| Bags API | covered (x-api-key + agent wallet-sig flow) | covered (base URL v1, `public-api-v2.bags.fm`) | covered (5k/hr per user AND per IP) | covered (Token Launch v2 made fee sharing mandatory) | covered (CRITICAL: creator-omission) |
| `@bagsfm/bags-sdk` | n/a (uses API key) | covered (v1.3.7, npm, pinned peer deps) | n/a | covered (v1.1.0 SDK updates in changelog) | covered (peer-dep version match) |
| Meteora DBC/DAMM V2 | n/a | covered (bundled via bags-sdk deps) | n/a | covered (graduation thresholds documented) | covered (MEDIUM: slot-wait for LUTs) |

## Gaps addressed

- **Migration threshold** was initially an open question on the Bags side. Resolved by browsing Meteora's migration docs, which document the keeper thresholds (≥10 SOL / ≥750 USDC / ≥1500 JUP). Cross-referenced that the v3 claim endpoint auto-detects pool state, so the coding agent does not need to branch on migration state manually.
- **Devnet availability** was unconfirmed. Resolved by checking program-ids and base-url docs: no devnet API exists; all testing is mainnet. Recorded as a constraint, not an open question.
- **SDK registry presence** was unconfirmed. Resolved via `npm info` — public, MIT, v1.3.7.

No category remains uncovered.
