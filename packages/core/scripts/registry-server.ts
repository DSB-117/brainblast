// Reference registry ingest server — the git-less on-ramp, runnable.
//
// This is a WORKING reference for what the off-repo registry (which holds the
// real Supabase key) exposes. It stands up `POST /api/vti` so a contributor can
// feed a Verified Trap Instance straight into the database instead of opening a
// PR. The safety is not "trust the client" — every submission runs the SAME
// gates as file/PR intake (secret scan + RED→GREEN under the hardened sandbox +
// consent), via `ingestSubmission`. Only records that reproduce land.
//
//   POST /api/vti   body: { finding, consentScope?, corroborationCount? }
//                   → 201 { accepted:true, trapId, method, proof }        (landed)
//                   → 200 { accepted:false, duplicate:true, trapId }      (already present)
//                   → 422 { accepted:false, reasons }                     (failed a gate)
//   GET  /api/vti   → 200 { count, records:[ …sample-tier teasers… ] }
//
// The routing is a pure function (`route`) so it can be unit-tested without a
// port; `serve()` is a thin node:http wrapper. Swap `JsonlVtiStore` for a
// Supabase-backed `VtiStore` and this same file is the production endpoint.
//
//   npm run registry:serve                 # :8787, store at datasets/contrib/contrib-vti.jsonl
//   BRAINBLAST_INGEST_TOKEN=… npm run registry:serve   # require Bearer token
//
// Env:
//   PORT                     listen port (default 8787)
//   BRAINBLAST_VTI_STORE     JSONL store path (default datasets/contrib/contrib-vti.jsonl)
//   BRAINBLAST_INGEST_TOKEN  if set, POST requires `Authorization: Bearer <token>`
//                            (GET stays open — the sample tier is public). Unset =
//                            open like the fleet ledger; the gates are the real guard.

import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSubmission } from "../src/contrib/submit.ts";
import { JsonlVtiStore, toTeaser, type VtiStore } from "../src/contrib/store.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const DEFAULT_STORE = join(repoRoot, "datasets", "contrib", "contrib-vti.jsonl");

export interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

// Pure router — no I/O of its own beyond the injected store. `authorized` is the
// transport's verdict on the Authorization header (kept out of here so the router
// stays testable).
export async function route(
  method: string,
  path: string,
  body: unknown,
  store: VtiStore,
  opts: { authorized?: boolean } = {},
): Promise<RouteResponse> {
  if (path !== "/api/vti") {
    return { status: 404, body: { error: "not found" } };
  }

  if (method === "GET") {
    const records = store.list().map(toTeaser);
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

    const result = await ingestSubmission(finding, { consentScope, corroborationCount });
    if (!result.accepted) {
      return { status: 422, body: { accepted: false, trapId: result.trapId, reasons: result.reasons, proof: result.proof } };
    }

    const ins = store.insert(result.vti as any);
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

export function serve(port = Number(process.env.PORT ?? 8787), storePath = process.env.BRAINBLAST_VTI_STORE ?? DEFAULT_STORE) {
  const store = new JsonlVtiStore(storePath);
  const token = process.env.BRAINBLAST_INGEST_TOKEN;

  const server = createServer(async (req, res) => {
    const send = (r: RouteResponse) => {
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const authorized = !token || req.headers.authorization === `Bearer ${token}`;
      let body: unknown;
      try {
        body = req.method === "POST" ? await readBody(req) : undefined;
      } catch (e: any) {
        return send({ status: 413, body: { accepted: false, reasons: [e?.message ?? "bad body"] } });
      }
      send(await route(req.method ?? "GET", url.pathname, body, store, { authorized }));
    } catch (e: any) {
      send({ status: 500, body: { error: e?.message ?? "internal error" } });
    }
  });

  server.listen(port, () => {
    console.error(`brainblast registry ingest — POST/GET http://localhost:${port}/api/vti`);
    console.error(`  store: ${storePath}`);
    console.error(`  auth:  ${token ? "Bearer token required for POST" : "open (gates are the guard)"}`);
  });
  return server;
}

// Run when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  serve();
}
