# Research Plan

## Stripe
**Type:** API + SDK
**Priority:** High
**Sources to check:**
1. SDK version + engines: https://registry.npmjs.org/stripe/latest
2. Authentication (keys, test vs live): https://docs.stripe.com/api/authentication
3. API versioning / pinning model: https://docs.stripe.com/api/versioning
4. Webhook signature verification + raw body: https://docs.stripe.com/webhooks (and /webhooks/signatures)
5. stripe-node webhook source (tolerance, raw body): https://github.com/stripe/stripe-node `src/Webhooks.ts`, `README.md`
6. Idempotency keys: https://docs.stripe.com/api/idempotent_requests
7. Rate limits: https://docs.stripe.com/rate-limits

## Privy
**Type:** Auth + SDK
**Priority:** High
**Sources to check:**
1. Client SDK version: https://registry.npmjs.org/@privy-io/react-auth/latest
2. Server SDK versions: https://registry.npmjs.org/@privy-io/node/latest and `@privy-io/server-auth/latest`
3. React setup + embedded wallets: https://docs.privy.io/basics/react/setup
4. Access token format + server verification: https://docs.privy.io/authentication/user-authentication/access-tokens
5. Webhooks (Svix, signature verify): https://docs.privy.io/api-reference/webhooks/overview
6. Doc index for correct URLs: https://docs.privy.io/llms.txt, https://docs.privy.io/llms-full.txt

Priority order applied throughout: official docs > package registry > official GitHub source > community.
