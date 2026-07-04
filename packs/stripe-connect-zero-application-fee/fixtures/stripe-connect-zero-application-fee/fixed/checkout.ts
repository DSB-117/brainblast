import Stripe from "stripe";

export async function createCharge(stripe: Stripe, connectedAccount: string) {
  // FIXED: the platform collects a real, non-zero fee on the Connect charge.
  return stripe.paymentIntents.create({
    amount: 5000,
    currency: "usd",
    application_fee_amount: 500,
    transfer_data: { destination: connectedAccount },
  });
}
