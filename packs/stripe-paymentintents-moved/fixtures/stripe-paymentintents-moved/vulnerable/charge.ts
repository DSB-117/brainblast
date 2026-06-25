// VULNERABLE: `stripe.paymentIntent` (singular) is not a resource on the Stripe
// Node SDK — the correct namespace is `paymentIntents` (plural). An agent that
// "knows" the REST path `/v1/payment_intents` routinely emits the singular member
// name. This compiles in the agent's head but FAILS to type-check against
// stripe@17 (TS2339: Property 'paymentIntent' does not exist on type 'Stripe').
import Stripe from "stripe";

const stripe = new Stripe("sk_test_placeholder");

export async function chargeCustomer(amount: number) {
  return stripe.paymentIntent.create({ amount, currency: "usd" });
}
