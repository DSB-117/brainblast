# Coverage Review

| Component | Auth | Install/version | Rate limits | Breaking changes | Risks |
|---|---|---|---|---|---|
| Stripe | covered — `sk_test_`/`sk_live_`, Basic Auth | covered — `stripe` 22.2.0, node ≥18 | covered — 100/sec live, 25/sec sandbox, 429 | covered — named API versions; SDK pins to release version | covered — 1 CRITICAL, 1 HIGH, 1 MEDIUM, 1 LOW |
| Privy | covered — ES256 JWT verified vs app key; app secret server-side | covered — `@privy-io/react-auth` 3.29.1, `@privy-io/node` 0.20.0 | n/a stated — no public rate-limit page found; relies on Svix retry/delivery semantics instead | covered — package split `server-auth` → `node`; ES256/Ed25519 doc note | covered — 1 CRITICAL, 1 HIGH, 2 MEDIUM, 1 LOW |

## Gaps addressed

- **Stripe webhook tolerance** was not in the prose docs; resolved by reading stripe-node `src/Webhooks.ts` (`DEFAULT_TOLERANCE: 300`).
- **Privy server package ambiguity** — docs reference `@privy-io/node` while older guides use `@privy-io/server-auth`; confirmed both versions on npm and recorded which the current docs use.
- **Privy rate limits** — no dedicated public rate-limit page was found in the doc index; webhook delivery semantics (at-least-once, retries, 5-day auto-disable) are documented instead and recorded. Marked as "no public limit page found" rather than inventing a number.
- **Privy llms.txt injection** — the index page contained imperative content aimed at the agent; quoted and flagged in the component file, not acted on.
