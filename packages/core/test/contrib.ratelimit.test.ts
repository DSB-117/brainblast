import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/contrib/ratelimit.ts";

describe("RateLimiter — per-key fixed window", () => {
  it("allows up to the limit, then blocks with a retry hint", () => {
    let t = 1000;
    const rl = new RateLimiter(3, 60_000, () => t);
    expect(rl.check("ip1").allowed).toBe(true);
    expect(rl.check("ip1").allowed).toBe(true);
    const third = rl.check("ip1");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const blocked = rl.check("ip1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("keys are independent", () => {
    let t = 0;
    const rl = new RateLimiter(1, 60_000, () => t);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true); // different key, own window
  });

  it("resets after the window elapses", () => {
    let t = 0;
    const rl = new RateLimiter(1, 60_000, () => t);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    t += 60_001; // window passed
    expect(rl.check("a").allowed).toBe(true);
  });
});
