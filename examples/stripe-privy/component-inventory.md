# Component Inventory

| Component | Type | Role | Confidence |
|---|---|---|---|
| Stripe API | API | Create PaymentIntents and receive payment-success webhooks | High |
| `stripe` (stripe-node) | SDK | Official Node server SDK for the Stripe API and webhook verification | High |
| Privy | Auth | User login, embedded wallets, and access tokens that authenticate backend requests | High |
| `@privy-io/react-auth` | SDK | Client SDK that renders login UI and issues/refreshes the user access token | High |
| `@privy-io/node` | SDK | Server SDK to verify access tokens and verify incoming Privy webhooks | High |
| Svix | Infra | Delivery + signing layer Privy uses for webhooks (verification headers come from Svix) | Medium |

**Excluded:** React itself, Node standard library, the app's own database (not a named external service in the spec).
