export function addAmounts(a: string, b: string): string {
  // VULNERABLE: coerces base-unit amounts to Number, which loses integer precision
  // above 2^53 (MAX_SAFE_INTEGER). Large lamport / wei / smallest-unit balances are
  // silently rounded, so the sum is wrong by a few units — funds vanish or appear.
  return String(Number(a) + Number(b));
}
