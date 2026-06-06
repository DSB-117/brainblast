// FIXED FIXTURE.
// Verifies the Stripe signature on the RAW body before trusting the event.
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_x");

export function handleStripeWebhook(rawBody: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret); // throws on bad signature
  // ... business logic, now safe ...
  return { received: true, type: event.type };
}
