// VULNERABLE: parses the body without verifying the Stripe signature.
export function handleStripeWebhook(rawBody: string, _signature: string) {
  const event = JSON.parse(rawBody);
  return { received: true, type: event.type };
}
