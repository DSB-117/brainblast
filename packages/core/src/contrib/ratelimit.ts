// Per-key fixed-window rate limiter — the griefing defence for the OPEN endpoint.
//
// The auth decision (see registry-server.ts) is: OPEN by default, like the fleet
// ledger — the gates (secret scan + RED→GREEN + provenance) are the real guard,
// not a shared password. But open + expensive (each POST runs the prover) needs a
// throttle so one caller can't exhaust the server. This is that throttle: a small
// in-memory fixed-window counter keyed by client IP.
//
// In-memory is right for the single-process reference server. A multi-instance
// deploy swaps this for the same shape backed by Redis/Upstash — the interface is
// one method, `check(key)`.

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets (for a Retry-After header). */
  retryAfterMs: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  // `limit` requests per `windowMs`. `now` is injectable for tests.
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(key: string): RateLimitVerdict {
    const t = this.now();
    const rec = this.hits.get(key);

    if (!rec || t >= rec.resetAt) {
      // New window. Opportunistically prune expired keys so the map can't grow
      // unbounded under a churn of distinct IPs.
      if (this.hits.size > 4096) {
        for (const [k, v] of this.hits) if (t >= v.resetAt) this.hits.delete(k);
      }
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterMs: 0 };
    }

    if (rec.count >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: rec.resetAt - t };
    }
    rec.count += 1;
    return { allowed: true, remaining: this.limit - rec.count, retryAfterMs: rec.resetAt - t };
  }
}
