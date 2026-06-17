// VULNERABLE: a secret-shaped env value is read into a local variable and
// then logged directly.
export function debugHandler(req: unknown) {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  console.log("using key", apiKey);
  return { ok: true };
}
