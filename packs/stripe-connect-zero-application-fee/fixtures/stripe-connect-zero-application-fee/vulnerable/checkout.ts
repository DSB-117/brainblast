import Stripe from "stripe";

export async function createCharge(stripe: Stripe, amount: number, connectedAccount: string) {
  // VULNERABLE: application_fee_amount: 0 — the platform collects nothing on this Connect charge.
  return stripe.paymentIntents.create({
    amount,
    currency: "usd",
    application_fee_amount: 0,
    transfer_data: { destination: connectedAccount },
  });
}
