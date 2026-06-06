// VULNERABLE FIXTURE.
// Parses the Stripe webhook body without verifying the signature.
// A forged "payment_intent.succeeded" is accepted -> the silent money trap.
export function handleStripeWebhook(rawBody: string, _signature: string) {
  const event = JSON.parse(rawBody);
  // ... business logic that grants paid access based on event.type ...
  return { received: true, type: event.type };
}
