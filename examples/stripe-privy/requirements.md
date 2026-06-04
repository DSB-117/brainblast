# Requirements: Paid SaaS with Privy login and Stripe checkout

Build the backend for a web app where:

- Users sign in with **Privy** (embedded wallets, email/social login). The React frontend
  holds the session; our Node backend authenticates each API request as the logged-in user.
- Paying users check out with **Stripe**. We create a PaymentIntent server-side and unlock
  premium access when the payment succeeds.
- Stripe **webhooks** tell our backend when a payment actually succeeds (don't trust the
  client). Privy **webhooks** notify us when a user is created so we can provision their row.

Stack: Node.js backend, React frontend. TypeScript.

Out of scope: the actual premium features, the frontend UI, and email receipts.
