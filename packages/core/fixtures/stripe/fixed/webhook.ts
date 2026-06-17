// FIXED: verifies the Stripe signature on the raw body before trusting the event.
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_x");

export function handleStripeWebhook(rawBody: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  return { received: true, type: event.type };
}
