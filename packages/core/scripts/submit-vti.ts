// submit-vti — the contributor's git-less on-ramp (client side).
//
// Reads a candidate Finding (the same JSON shape as fleet/candidates/*.json) and
// POSTs it to the registry's `/api/vti` endpoint, which re-proves it RED→GREEN
// server-side and, if it reproduces, inserts it into the corpus database — no
// fork, no branch, no PR. The reproduction gate runs on the SERVER, so the client
// is never trusted; a non-reproducing or secret-bearing submission is rejected
// with reasons.
//
//   npm run submit:vti -- --candidate fleet/candidates/<id>.json
//   npm run submit:vti -- --candidate <file> --consent opt-in:train
//   npm run submit:vti -- --candidate <file> --dry-run     # validate+prove locally, don't POST
//
// Registry URL: FLEET_REGISTRY_URL (default https://registry.brainblast.tech),
// same override the fleet discover/ledger clients use. Bearer token via
// BRAINBLAST_INGEST_TOKEN when the registry requires one.

import { readFileSync } from "node:fs";
import { DEFAULT_REGISTRY_URL } from "../src/telemetry.ts";
import { ingestSubmission } from "../src/contrib/submit.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const REGISTRY = (process.env.FLEET_REGISTRY_URL ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, "");

async function main() {
  const file = arg("candidate");
  if (!file) {
    console.error("submit-vti — POST a candidate Finding straight into the corpus (no PR)\n");
    console.error("  usage: npm run submit:vti -- --candidate fleet/candidates/<id>.json [--consent opt-in:train+eval] [--dry-run]");
    process.exit(2);
  }
  const consentScope = (arg("consent") ?? "opt-in:train+eval") as any;
  const dryRun = process.argv.includes("--dry-run");

  let finding: unknown;
  try {
    finding = JSON.parse(readFileSync(file, "utf8"));
  } catch (e: any) {
    console.error(`  ✗ cannot read/parse ${file}: ${e?.message ?? e}`);
    process.exit(1);
  }

  const id = (finding as any)?.id ?? "(no id)";

  // --dry-run: run the identical gate locally so a contributor can see accept/
  // reject BEFORE sending anything over the wire. (Same code the server runs.)
  if (dryRun) {
    console.error(`submit-vti — DRY RUN (local gate, nothing sent) · ${id}\n`);
    const r = await ingestSubmission(finding, { consentScope });
    if (r.accepted) {
      console.error(`  ✓ would ACCEPT ${r.trapId} — proved RED→GREEN via ${r.method} (red=${r.proof?.red}, green=${r.proof?.green})`);
    } else {
      console.error(`  ✗ would REJECT ${r.trapId ?? id}:`);
      for (const reason of r.reasons) console.error(`      - ${reason}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(`submit-vti — ${REGISTRY}/api/vti · ${id}\n`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.BRAINBLAST_INGEST_TOKEN) headers.authorization = `Bearer ${process.env.BRAINBLAST_INGEST_TOKEN}`;

  let res: Response;
  try {
    res = await fetch(`${REGISTRY}/api/vti`, { method: "POST", headers, body: JSON.stringify({ finding, consentScope }) });
  } catch (e: any) {
    console.error(`  ✗ registry unreachable (${e?.message ?? e}). Try --dry-run to validate locally.`);
    process.exit(1);
  }

  const out: any = await res.json().catch(() => ({}));
  if (res.status === 201 && out.accepted) {
    console.error(`  ✓ LANDED ${out.trapId} — server proved RED→GREEN via ${out.method}. Now in the corpus, no PR.`);
  } else if (res.status === 200 && out.duplicate) {
    console.error(`  = already present: ${out.trapId} (idempotent — the trap is already in the corpus)`);
  } else {
    console.error(`  ✗ REJECTED (${res.status}) ${out.trapId ?? id}:`);
    for (const reason of out.reasons ?? [out.error ?? "unknown error"]) console.error(`      - ${reason}`);
    process.exit(1);
  }
}

main();
