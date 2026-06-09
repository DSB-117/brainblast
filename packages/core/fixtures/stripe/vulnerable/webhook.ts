// VULNERABLE: imports stripe but parses the body without verifying the signature.
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_x");

export function handleStripeWebhook(rawBody: string, _signature: string) {
  const event = JSON.parse(rawBody);
  return { received: true, type: event.type };
}
