import rateLimit from "express-rate-limit";

export function makeLoginLimiter() {
  // FIXED: a real per-window cap throttles brute-force attempts.
  return rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
}
