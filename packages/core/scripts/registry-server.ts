// Reference registry ingest server — the git-less on-ramp, runnable.
//
// This is a WORKING reference for what the off-repo registry (which holds the
// real Supabase key) exposes. It stands up `POST /api/vti` so a contributor can
// feed a Verified Trap Instance straight into the database instead of opening a
// PR. The safety is not "trust the client" — every submission runs the SAME
// gates as file/PR intake, via `ingestSubmission`:
//   secret scan + RED→GREEN (hardened sandbox) + consent + PROVENANCE (the cited
//   commit is fetched and the vulnerable line confirmed to exist there).
// Only real, reproducing records land.
//
//   POST /api/vti   body: { finding, consentScope?, corroborationCount? }
//                   → 201 { accepted:true, trapId, method, proof }        (landed)
//                   → 200 { accepted:false, duplicate:true, trapId }      (already present)
//                   → 422 { accepted:false, reasons }                     (failed a gate)
//                   → 429 { reasons:["rate limited"] }                    (too many requests)
//   GET  /api/vti   → 200 { count, records:[ …sample-tier teasers… ] }
//
// The routing is a pure function (`route`) so it can be unit-tested without a
// port; `serve()` is a thin node:http wrapper. `storeFromEnv` picks Supabase when
// configured, else the local JSONL reference — the same file is the prod endpoint.
//
// AUTH POSTURE — OPEN by default, like the fleet ledger. The gates above are the
// real guard, not a shared password (per the project's "prefer simple, open
// designs" bar). A per-IP rate limit stops one caller exhausting the prover; set
// BRAINBLAST_INGEST_TOKEN to close POST behind a Bearer token if you must.
//
//   npm run registry:serve                              # :8787, JSONL store, open + rate-limited
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run registry:serve   # prod store
//   BRAINBLAST_INGEST_TOKEN=… npm run registry:serve    # require Bearer token on POST
//
// Env:
//   PORT                        listen port (default 8787)
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)  → Supabase store
//   BRAINBLAST_VTI_TABLE        Supabase table name (default "vtis")
//   BRAINBLAST_VTI_STORE        JSONL path when Supabase isn't configured
//   BRAINBLAST_INGEST_TOKEN     if set, POST requires `Authorization: Bearer <token>`
//   BRAINBLAST_INGEST_RATELIMIT requests per IP per minute (default 30; 0 = off)
//   BRAINBLAST_VERIFY_PROVENANCE  "0" disables the anti-fabrication fetch (default ON)

import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSubmission } from "../src/contrib/submit.ts";
import { storeFromEnv, toTeaser, type VtiStore } from "../src/contrib/store.ts";
import { RateLimiter } from "../src/contrib/ratelimit.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const DEFAULT_STORE = join(repoRoot, "datasets", "contrib", "contrib-vti.jsonl");

export interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface RouteOptions {
  /** Transport's verdict on the Authorization header (kept out of the router so
   *  it stays testable). `false` → 401. `undefined`/`true` → allowed. */
  authorized?: boolean;
  /** Run the provenance / anti-fabrication gate on POST (fetches the cited commit). */
  verifyProvenance?: boolean;
  /** Injectable fetch for the provenance check (tests). */
  fetchImpl?: typeof fetch;
}

// Pure router — no I/O of its own beyond the injected (async) store. Rate
// limiting lives in the transport wrapper (it needs the client IP).
export async function route(
  method: string,
  path: string,
  body: unknown,
  store: VtiStore,
  opts: RouteOptions = {},
): Promise<RouteResponse> {
  if (path !== "/api/vti") {
    return { status: 404, body: { error: "not found" } };
  }

  if (method === "GET") {
    const records = (await store.list()).map(toTeaser);
    return { status: 200, body: { count: records.length, records } };
  }

  if (method === "POST") {
    if (opts.authorized === false) {
      return { status: 401, body: { accepted: false, reasons: ["missing or invalid Bearer token"] } };
    }
    const payload = (body ?? {}) as Record<string, unknown>;
    // Accept either { finding, consentScope } or a bare Finding for convenience.
    const finding = "finding" in payload ? payload.finding : payload;
    const consentScope = payload.consentScope as any;
    const corroborationCount = payload.corroborationCount as any;

    const result = await ingestSubmission(finding, {
      consentScope,
      corroborationCount,
      verifyProvenance: opts.verifyProvenance,
      fetchImpl: opts.fetchImpl,
    });
    if (!result.accepted) {
      return { status: 422, body: { accepted: false, trapId: result.trapId, reasons: result.reasons, proof: result.proof } };
    }

    const ins = await store.insert(result.vti as any);
    if (!ins.inserted) {
      // Reproduced fine, but the trap is already in the DB — idempotent success.
      return { status: 200, body: { accepted: true, duplicate: true, trapId: result.trapId, reason: ins.reason } };
    }
    return { status: 201, body: { accepted: true, trapId: result.trapId, method: result.method, proof: result.proof } };
  }

  return { status: 405, body: { error: `method ${method} not allowed` } };
}

async function readBody(req: import("node:http").IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function clientIp(req: import("node:http").IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export function serve(port = Number(process.env.PORT ?? 8787), storePath = process.env.BRAINBLAST_VTI_STORE ?? DEFAULT_STORE) {
  const store: VtiStore = storeFromEnv(storePath);
  const usingSupabase = !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY));
  const token = process.env.BRAINBLAST_INGEST_TOKEN;
  const verifyProv = process.env.BRAINBLAST_VERIFY_PROVENANCE !== "0";
  const rlPerMin = Number(process.env.BRAINBLAST_INGEST_RATELIMIT ?? 30);
  const limiter = rlPerMin > 0 ? new RateLimiter(rlPerMin, 60_000) : null;

  const server = createServer(async (req, res) => {
    const send = (r: RouteResponse, extraHeaders: Record<string, string> = {}) => {
      res.writeHead(r.status, { "content-type": "application/json", ...extraHeaders });
      res.end(JSON.stringify(r.body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";

      // Per-IP rate limit — only throttle the expensive write path (POST).
      if (method === "POST" && limiter) {
        const verdict = limiter.check(clientIp(req));
        if (!verdict.allowed) {
          return send(
            { status: 429, body: { accepted: false, reasons: ["rate limited — slow down"] } },
            { "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)) },
          );
        }
      }

      const authorized = !token || req.headers.authorization === `Bearer ${token}`;
      let body: unknown;
      try {
        body = method === "POST" ? await readBody(req) : undefined;
      } catch (e: any) {
        return send({ status: 413, body: { accepted: false, reasons: [e?.message ?? "bad body"] } });
      }
      send(await route(method, url.pathname, body, store, { authorized, verifyProvenance: verifyProv }));
    } catch (e: any) {
      send({ status: 500, body: { error: e?.message ?? "internal error" } });
    }
  });

  server.listen(port, () => {
    console.error(`brainblast registry ingest — POST/GET http://localhost:${port}/api/vti`);
    console.error(`  store:      ${usingSupabase ? `Supabase (${process.env.BRAINBLAST_VTI_TABLE ?? "vtis"})` : storePath}`);
    console.error(`  auth:       ${token ? "Bearer token required for POST" : "open (gates are the guard)"}`);
    console.error(`  rate limit: ${limiter ? `${rlPerMin} POST/min per IP` : "off"}`);
    console.error(`  provenance: ${verifyProv ? "ON — cited commit fetched + verified" : "OFF"}`);
  });
  return server;
}

// Run when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  serve();
}
