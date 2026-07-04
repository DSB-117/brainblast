// reprove-submissions — the brainblast side of the reconciliation loop.
//
// A VTI submitted to the registry's POST /api/vti lands provenance-verified but
// proof_verified=false, because the registry has no prover. This job runs where
// the prover DOES live: it pulls the unproven queue, re-runs the REAL RED→GREEN
// gate on each submission, and writes the verdict back — flipping proof_verified
// so the record surfaces in the served corpus (catalog + homepage) with no PR.
//
// This is the guarantee the direct API can't make on its own: a fabricated fixture
// that provenance somehow passed still has to reproduce through a vetted checker
// here, or it never reaches the corpus.
//
//   BRAINBLAST_REPROVE_TOKEN   shared secret (also set in the registry's Vercel env)
//   FLEET_REGISTRY_URL         default https://registry.brainblast.tech
//
// Run: npm run reprove   (scheduled via .github/workflows/reprove.yml)

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proveFinding } from "../src/synth/index.ts";
import { DEFAULT_REGISTRY_URL } from "../src/telemetry.ts";
import type { Finding } from "../src/synth/types.ts";

const REGISTRY = (process.env.FLEET_REGISTRY_URL ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, "");
const TOKEN = process.env.BRAINBLAST_REPROVE_TOKEN;

async function main() {
  if (!TOKEN) {
    console.error("reprove — BRAINBLAST_REPROVE_TOKEN is required (shared with the registry).");
    process.exit(2);
  }
  const auth = { authorization: `Bearer ${TOKEN}` };

  let queue: { count: number; items: { trapId: string; finding: Finding }[] };
  try {
    const res = await fetch(`${REGISTRY}/api/vti/queue`, { headers: auth });
    if (!res.ok) {
      console.error(`reprove — queue fetch ${res.status}: ${(await res.text()).slice(0, 200)}`);
      process.exit(1);
    }
    queue = await res.json();
  } catch (e: any) {
    console.error(`reprove — registry unreachable: ${e?.message ?? e}`);
    process.exit(1);
  }

  console.error(`reprove — ${REGISTRY} · ${queue.items.length} unproven submission(s)\n`);
  const stageRoot = mkdtempSync(join(tmpdir(), "bb-reprove-"));
  let proven = 0;
  let drafted = 0;
  let skipped = 0;

  try {
    for (const it of queue.items) {
      const f = it.finding;
      if (!f?.binding?.check?.kind || !f?.detect || !f?.fixtures?.vulnerable) {
        console.error(`  ~ ${it.trapId}: skipped (record predates detect/binding storage — re-submit to backfill)`);
        skipped++;
        continue;
      }

      let verdict;
      try {
        // "ingest" — the hardened context (untrusted, publicly-submitted code).
        // Static/CST checkers never execute code; behavioral kinds refuse without
        // a sandbox rather than fall back.
        verdict = await proveFinding(f, stageRoot, "ingest");
      } catch (e: any) {
        console.error(`  ✗ ${it.trapId}: prove threw — ${e?.message ?? e}`);
        drafted++;
        continue;
      }

      const ok = verdict.verdict === "PROVEN";
      if (ok) proven++;
      else drafted++;

      let posted = true;
      try {
        const vr = await fetch(`${REGISTRY}/api/vti/verify`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ trapId: it.trapId, proofVerified: ok, method: verdict.method ?? "static-checker" }),
        });
        posted = vr.ok;
      } catch {
        posted = false;
      }

      const how = ok ? `PROVEN via ${verdict.method}` : `DRAFT — ${verdict.reason ?? "did not reproduce"}`;
      console.error(`  ${ok ? "✓" : "✗"} ${it.trapId}: ${how}${posted ? "" : "  (verify POST failed)"}`);
    }
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }

  console.error(`\nreprove — proven: ${proven}  drafted: ${drafted}  skipped: ${skipped}`);
}

main();
