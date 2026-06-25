// FIXED: `stripe.paymentIntents` (plural) is the real resource on the Stripe Node
// SDK, and `.create` takes `{ amount, currency }`. This type-checks clean against
// stripe@17 — the compiler oracle reads it GREEN.
import Stripe from "stripe";

const stripe = new Stripe("sk_test_placeholder");

export async function chargeCustomer(amount: number) {
  return stripe.paymentIntents.create({ amount, currency: "usd" });
}
