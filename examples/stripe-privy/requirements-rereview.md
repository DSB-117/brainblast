# Requirements Re-review

## Missing constraints

- **Raw-body webhook route.** The spec says "Stripe webhooks tell our backend when a payment succeeds" but doesn't state that the Stripe webhook route must read the **raw** body. A default JSON body parser silently breaks signature verification. This must be designed in, not discovered later.
- **API version pinning.** The spec doesn't mention Stripe's `apiVersion`. Because the SDK and webhook payloads resolve versions differently, the version must be pinned in both the SDK and the webhook endpoint before launch.
- **Token claim checks.** "Authenticate each API request as the logged-in user" understates the work: the backend must verify the ES256 signature *and* the `aud`/`iss` claims, not just decode the token.

## Wrong assumptions

- **"Don't trust the client" is only half-applied.** The spec correctly distrusts the client for payment success (uses webhooks) but implicitly trusts the Privy access token. The token is equally untrusted until cryptographically verified server-side.
- **One server SDK.** The spec implies a single Privy server library. There are two (`@privy-io/node` vs `@privy-io/server-auth`); the choice matters because their APIs differ.

## Underspecified decisions

- Which Stripe API version to pin (and matching the webhook endpoint to it).
- Bearer-token vs HTTP-only-cookie transport for the Privy access token (changes how the backend reads it).
- Which chains get embedded wallets and the `createOnLogin` policy (`users-without-wallets` vs `all-users`).
- Idempotency-key strategy for PaymentIntent creation.

## Immutable / hard-to-change choices

- **Stripe API version** behaves like a pinned contract: changing it later shifts request and webhook payload shapes across the integration, so pick it deliberately up front.
- **Privy app ID** is baked into the token `aud` and the frontend `PrivyProvider`; switching apps invalidates existing sessions.

## Sound

- Using server-side PaymentIntents + webhooks for fulfillment (instead of trusting a client success callback) is the correct Stripe pattern.
- Using Privy access tokens to authenticate backend requests is the intended Privy design; the gap is only in verifying them rigorously.
