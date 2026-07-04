export function isExpired(nowSeconds: number, expSeconds: number): boolean {
  // VULNERABLE: exp is a JWT `exp` claim in SECONDS, but this multiplies it by 1000
  // (as if comparing against Date.now() in ms) while `now` is already in seconds.
  // exp is pushed ~1000x into the future, so a token NEVER reads as expired — every
  // expired/stale token is accepted. Full auth bypass.
  return nowSeconds >= expSeconds * 1000;
}
