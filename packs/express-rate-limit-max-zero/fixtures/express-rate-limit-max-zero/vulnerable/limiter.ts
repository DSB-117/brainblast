import rateLimit from "express-rate-limit";

export function makeLoginLimiter() {
  // VULNERABLE: max: 0 disables the limit — the login route can be brute-forced without any throttle.
  return rateLimit({ windowMs: 15 * 60 * 1000, max: 0 });
}
