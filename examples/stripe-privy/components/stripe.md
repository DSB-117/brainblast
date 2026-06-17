# Component Research: Stripe

**Date checked:** 2026-06-04
**Sources:**
- https://registry.npmjs.org/stripe/latest (npm metadata)
- https://docs.stripe.com/api/authentication
- https://docs.stripe.com/api/versioning
- https://docs.stripe.com/webhooks (webhook setup + signature verification)
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/rate-limits
- https://github.com/stripe/stripe-node — `src/Webhooks.ts`, `README.md`

---

## Facts

**SDK package**
- Package: `stripe` (the official "stripe-node"). Current version **22.2.0**, license MIT, `engines.node >= 18`. (npm registry, 2026-06-04)
- Install: `npm install stripe`
- Init: `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)` (README)

**Authentication**
- Stripe authenticates with API keys via HTTP Basic Auth — the key is the basic-auth username, no password. (https://docs.stripe.com/api/authentication)
- Test-mode secret keys are prefixed `sk_test_`; live-mode secret keys `sk_live_`. Restricted keys (`rk_…`) give granular scopes.
- "Don't embed secret (or restricted) API keys in source code or client-side applications." Use a secrets vault or environment variables. (https://docs.stripe.com/api/authentication)

**API version pinning**
- The current API version is `2026-05-27.dahlia`. Major releases (named, e.g. "Dahlia") contain backward-incompatible changes; monthly releases under the same name are backward-compatible. (https://docs.stripe.com/api/versioning)
- stripe-node config option `apiVersion` defaults to `null`; when unset, "stripe-node will use the latest version at the time of release." (stripe-node `README.md`)
- Requests made without an explicit `Stripe-Version` header use **the account's default API version**, set in Workbench. (https://docs.stripe.com/api/versioning)
- **Webhook events use the account's default API version by default, unless you set an API version when creating the webhook endpoint.** (https://docs.stripe.com/api/versioning)

**Webhook signature verification**
- Verify each event with the SDK: `stripe.webhooks.constructEvent(rawBody, sigHeader, endpointSecret)`. The signature header is `Stripe-Signature`; the endpoint secret is prefixed `whsec_`. (stripe-node `README.md`, docs.stripe.com/webhooks)
- "You must pass the _raw_ request body, exactly as received from Stripe… this will not work with a parsed (i.e., JSON) request body." Body-parsing middleware (e.g. `express.json()`) on the webhook route breaks verification. (stripe-node `README.md`)
- Default timestamp tolerance is **300 seconds (5 minutes)**: `DEFAULT_TOLERANCE: 300, // 5 minutes`. (stripe-node `src/Webhooks.ts` line 88; used at line 109)
- Only the `v1` signature scheme is valid in live mode; `v0` is a fake scheme for test events. "To prevent downgrade attacks, ignore all schemes that aren't `v1`." Signatures are HMAC-SHA256 over `timestamp.payload`. (https://docs.stripe.com/webhooks)
- Replay protection: the signed `Stripe-Signature` timestamp lets you reject payloads that are too old. (https://docs.stripe.com/webhooks)
- Live-mode webhook endpoints must be HTTPS; Stripe supports only TLS 1.2 and 1.3. Up to 16 event destinations per account. (https://docs.stripe.com/webhooks)

**Idempotency**
- Pass an `Idempotency-Key` header (stripe-node: `{ idempotencyKey }` request option) on POST requests to retry safely without duplicating the operation. (https://docs.stripe.com/api/idempotent_requests)
- Stripe saves the first response (status + body) for each key, including `500`s, and replays it for repeats. Keys are recommended to be V4 UUIDs, up to 255 chars, and are pruned after ≥24 hours.
- Only `POST` requests use idempotency keys; `GET`/`DELETE` ignore them (already idempotent). Reusing a key with different parameters errors.

**Rate limits**
- Basic rate limiter: **100 operations/sec in live mode, 25/sec in a sandbox**. Individual endpoints default to 25 requests/sec and also count against the global limit. (https://docs.stripe.com/rate-limits)
- Over-limit requests get `429` and a `Stripe-Rate-Limited-Reason` header indicating which limit was hit. Specific endpoints have their own ceilings (e.g. PaymentIntents: 1000 updates per intent per hour).

---

## Assumptions

- The webhook handler runs behind a framework whose default JSON body parser would consume the raw body; the integration must register a raw-body route specifically for the Stripe webhook path. (Assumed from the common Express/Next.js setup; not a Stripe-stated fact.)
- A single signing secret per endpoint is in play; if the integration uses multiple endpoints it must track one `whsec_` per endpoint.

---

## Inferences

- Because webhook events default to the **account** API version while the SDK is pinned to its **release** version, the Event object shape your typed code expects can silently diverge from what arrives — this follows from the two separate version-resolution rules in the versioning doc.
- Because idempotency results are only saved once endpoint execution begins (validation failures are not saved), a client may safely retry a request that failed validation with the same key — follows from the idempotency doc's "we save results only after execution begins."

---

## Risks

**CRITICAL — Forged payments accepted silently:**
If the webhook route does not call `stripe.webhooks.constructEvent` against the **raw** body with the `whsec_` secret (or parses the body first, breaking verification), an attacker can POST a fake `payment_intent.succeeded` event and the backend will unlock premium access for a payment that never happened. The happy path looks identical in tests because legitimate Stripe traffic still works — the hole is invisible until abused. Correct behavior: verify every event on the raw body before acting on it, and reject on failure.

**HIGH — API version drift between SDK and webhook payloads:**
stripe-node is pinned to the API version current at its release, but webhook events use the **account's** default version unless the endpoint is pinned. If they differ, fields the typed code reads may be renamed, moved, or absent — a silent `undefined` rather than an error. Decide and pin `apiVersion` in the SDK **and** set the webhook endpoint to the same version before launch.

**MEDIUM — Double charges on retry:**
Creating a PaymentIntent (a POST) without an `Idempotency-Key` means a network retry can create a second intent and double-charge the customer. Generate a V4 UUID idempotency key per logical checkout attempt.

**LOW — Rate limiting under burst:**
Live mode allows 100 ops/sec (25 in sandbox), 25/sec per endpoint. High-burst flows can hit `429`. Handle the `Stripe-Rate-Limited-Reason` header with backoff.

---

## Resolved questions

**Is the webhook signature tolerance configurable, and what's the default?**
Default is 300 seconds (5 minutes), set as `DEFAULT_TOLERANCE: 300` in stripe-node `src/Webhooks.ts` and passed to the verifier unless a `tolerance` argument overrides it. Source: https://github.com/stripe/stripe-node/blob/master/src/Webhooks.ts

**If I don't set `apiVersion`, which version do I get?**
The SDK uses the latest API version at the time that stripe-node release was published (config default `apiVersion: null`). It does **not** float to the newest API version over time, and it is independent of the account default that webhooks use. Source: stripe-node `README.md` config table + https://docs.stripe.com/api/versioning

**Does `constructEvent` work with a JSON-parsed body?**
No. stripe-node's README states you must pass the raw request body exactly as received; a parsed/JSON body fails verification. Source: https://github.com/stripe/stripe-node `README.md`
