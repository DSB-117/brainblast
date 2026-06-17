# Brainblast Research Report

**Run:** 20260604-130000
**Requirements:** Paid SaaS — Privy login + embedded wallets, Stripe checkout, webhook-driven fulfillment
**Date:** 2026-06-04
**Agent:** Brainblast v0.1.3 (committed demo run)

---

## Executive Summary

*The 30-second version.*

- **Building:** A Node backend that authenticates users via Privy access tokens and fulfills Stripe payments from verified webhooks.
- **Verdict:** Build with caution — the happy path is easy; three silent-failure traps are not, and two are auth/money critical.
- **Top risk:** A Stripe webhook handler that skips raw-body signature verification will accept forged `payment_intent.succeeded` events and grant premium access for payments that never happened.
- **Must decide first:** Pin the Stripe `apiVersion` in the SDK **and** on the webhook endpoint (changing it later shifts payload shapes), and pick the Privy server SDK (`@privy-io/node`).
- **Watch out for:** Two Privy server packages with different APIs, a raw-body requirement that default JSON middleware breaks, and a Privy docs page that tries to instruct the AI agent directly.

---

## Risk Heatmap

| Component | 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low |
|---|---|---|---|---|
| Stripe | 1 | 1 | 1 | 1 |
| Privy | 1 | 1 | 2 | 1 |
| **Total** | **2** | **2** | **3** | **2** |

**Critical & High, by name:**
1. **[CRITICAL] Stripe — forged payments accepted** — webhook route doesn't verify the raw body against `whsec_`, so fake success events unlock paid features.
2. **[CRITICAL] Privy — auth bypass** — backend trusts a decoded-but-unverified access token (or skips `aud`/`iss` checks), running requests as an arbitrary user.
3. **[HIGH] Stripe — API version drift** — SDK pinned to release version but webhook payloads use the account default version, so typed fields silently go `undefined`.
4. **[HIGH] Privy — forged webhooks** — `user.created` events trusted without Svix signature verification, triggering provisioning from spoofed payloads.

---

## Components researched

| Component | Source found | Status |
|---|---|---|
| Stripe API | https://docs.stripe.com/ | Verified |
| `stripe` (stripe-node 22.2.0) | https://registry.npmjs.org/stripe/latest + GitHub `src/Webhooks.ts` | Verified |
| Privy auth + access tokens | https://docs.privy.io/authentication/user-authentication/access-tokens | Verified |
| `@privy-io/react-auth` 3.29.1 | https://registry.npmjs.org/@privy-io/react-auth/latest | Verified |
| `@privy-io/node` 0.20.0 | https://docs.privy.io/api-reference/webhooks/overview | Verified |
| Svix (Privy webhook transport) | https://docs.privy.io/api-reference/webhooks/overview | Partially verified (via Privy docs) |

---

## What a coding agent must know before starting

### 1. Verify the Stripe webhook on the RAW body, before anything else
Use `stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)`. The secret is the `whsec_…` endpoint secret. The body must be the **raw** bytes — `express.json()` or any parser on the webhook route destroys the signature and verification fails. Only act on `payment_intent.succeeded` after verification passes. Skipping this lets anyone forge a paid event. Default tolerance is 300s (stripe-node `src/Webhooks.ts:88`).

### 2. Pin the Stripe API version in two places
stripe-node defaults `apiVersion: null`, which means "the latest version at the time of release" — not the account default that webhooks use. Set `new Stripe(key, { apiVersion: '2026-05-27.dahlia' })` **and** set the same version on the webhook endpoint, so the Event payload shape matches your typed code. The current version is `2026-05-27.dahlia`.

### 3. Verify the Privy access token cryptographically, not just structurally
The token is an ES256 JWT with claims `sub` (user DID), `iss` (`privy.io`), `aud` (your app ID), `exp` (~1h). Authenticate a request by verifying the signature against your app's verification key (from the Privy Dashboard) using `@privy-io/node`, and assert `iss === 'privy.io'` and `aud === <your app id>`. Decoding claims without verifying is an auth bypass.

### 4. Use `@privy-io/node` (0.20.0), not `@privy-io/server-auth`
Two server SDKs are published. Current docs use `@privy-io/node` and its `PrivyClient`. Don't copy snippets from `@privy-io/server-auth` (1.32.5) tutorials — the APIs differ.

### 5. Verify Privy webhooks with the Svix headers
`new PrivyClient({ appId, appSecret, webhookSigningSecret }).webhooks().verify({ payload: req.body, headers: req.headers })`. The headers must include `svix-id`, `svix-timestamp`, `svix-signature`. It returns the verified payload or throws `InvalidWebhookError`. Return a 2xx or Privy disables the endpoint after 5 consecutive days of failures.

### 6. Embedded wallets need an explicit `createOnLogin`
In `PrivyProvider`, set `embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } }` (or `solana`). Omit it and users who log in without an external wallet get no wallet, breaking wallet-dependent code for exactly those users.

### 7. Add idempotency keys to PaymentIntent creation
Pass `{ idempotencyKey: <v4 uuid> }` on the create call so a network retry can't double-charge. Keys are POST-only and pruned after ~24h.

---

## Pre-coding decisions required

| Decision | Options | Why it matters |
|---|---|---|
| Stripe API version | Pin `2026-05-27.dahlia` (current) vs another named version | Hard to change later — shifts request and webhook payload shapes across the integration. Must match SDK + webhook endpoint. |
| Privy token transport | Bearer header vs HTTP-only cookie | Changes how the backend reads the token; cookie mode auto-includes it same-domain. |
| Embedded wallet policy | `users-without-wallets` vs `all-users`, and which chains | Determines who gets a wallet; affects all downstream wallet code. |
| Idempotency strategy | Per-checkout UUID vs none | Prevents double charges on retry. |

---

## Requirements corrections

- **"Don't trust the client" was only applied to payments.** The Privy access token is equally untrusted until verified server-side (signature + `aud`/`iss`). The spec implicitly trusts it.
- **The webhook raw-body constraint is unstated** but mandatory for Stripe signature verification.
- **API version pinning is unstated** but must be decided before launch because it is effectively immutable.
- **"A Privy server library" is ambiguous** — there are two with different APIs; pick `@privy-io/node`.

---

## What this report prevents

Coding straight from the one-paragraph spec, an agent would likely:

- Mount `express.json()` globally and verify the Stripe webhook on a parsed body → **every real event fails**, and worse, if it "fixes" that by skipping verification, **forged payment events unlock premium for free** (silent, money loss).
- Decode the Privy JWT and read `sub` without verifying the signature or `aud` → **auth bypass**: any token (or a token from another Privy app) is accepted.
- Reach for `@privy-io/server-auth` from an older tutorial and waste time on mismatched method signatures.
- Skip idempotency keys and double-charge customers on a retried PaymentIntent create.
