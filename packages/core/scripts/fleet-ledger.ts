// fleet:ledger — R7 autonomy, step 6 (the shared "already-investigated" ledger).
//
// So sibling fleets don't re-scout the same repos. Records each investigated repo
// + the traps found there. Writes to the registry's Supabase `fleet_ledger` table
// (PostgREST over fetch — no @supabase dep) when SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are set; otherwise updates the local
// fleet/ledger-cache.json that `fleet:discover` reads for its skip set.
//
//   npm run fleet:ledger -- --record fleet/worklist.json [--report fleet/REPORT.md]
//   npm run fleet:ledger -- --check                       # print the investigated set
//
// A repo is "investigated" once a fleet has scouted it, whether or not it yielded
// a trap (a clean repo is recorded too — that's the whole point of not redoing it).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const fleetDir = join(repoRoot, "fleet");
const cachePath = join(fleetDir, "ledger-cache.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

interface LedgerRow {
  repo: string;
  sdk: string | null;
  traps: string[]; // promoted candidate ids found in this repo (empty = clean)
  investigatedAt: string;
}

async function supabaseUpsert(rows: LedgerRow[]): Promise<void> {
  // PostgREST upsert (on_conflict=repo). Service-role key bypasses RLS.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fleet_ledger?on_conflict=repo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_KEY as string,
      authorization: `Bearer ${SUPABASE_KEY}`,
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(
      rows.map((r) => ({ repo: r.repo, sdk: r.sdk, traps: r.traps, investigated_at: r.investigatedAt })),
    ),
  });
  if (!res.ok) throw new Error(`supabase write ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function supabaseList(): Promise<LedgerRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fleet_ledger?select=repo,sdk,traps,investigated_at`, {
    headers: { apikey: SUPABASE_KEY as string, authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase read ${res.status}`);
  return (await res.json()).map((r: any) => ({ repo: r.repo, sdk: r.sdk, traps: r.traps ?? [], investigatedAt: r.investigated_at }));
}

function localList(): LedgerRow[] {
  if (!existsSync(cachePath)) return [];
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")).repos ?? [];
  } catch {
    return [];
  }
}

function localUpsert(rows: LedgerRow[]): void {
  const existing = new Map(localList().map((r) => [r.repo, r]));
  for (const r of rows) existing.set(r.repo, r);
  mkdirSync(fleetDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ repos: [...existing.values()] }, null, 2) + "\n");
}

// Map promoted pack ids to the repos they came from. The fleet REPORT records
// which candidates landed; the worklist records which repos were scouted. We
// record every scouted repo (clean or not) and attach any traps that mention it.
function buildRows(): LedgerRow[] {
  const wlPath = arg("record");
  if (!wlPath) {
    console.error("fleet:ledger --record needs a worklist path (fleet/worklist.json)");
    process.exit(2);
  }
  const wl = JSON.parse(readFileSync(join(repoRoot, wlPath.replace(/^.*\/fleet\//, "fleet/")), "utf8"));
  const now = new Date().toISOString();
  return (wl.worklist ?? []).map((w: any) => ({ repo: w.repo, sdk: wl.sdk ?? null, traps: w.traps ?? [], investigatedAt: now }));
}

async function main() {
  console.error(`fleet:ledger — ${usingSupabase ? "Supabase (shared)" : "local cache (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to share)"}\n`);

  if (process.argv.includes("--check")) {
    const rows = usingSupabase ? await supabaseList() : localList();
    console.error(`  ${rows.length} repo(s) on record:`);
    for (const r of rows.slice(0, 50)) console.error(`    ${r.repo}${r.traps.length ? `  → ${r.traps.join(", ")}` : "  (clean)"}`);
    process.exit(0);
  }

  const rows = buildRows();
  if (usingSupabase) {
    try {
      await supabaseUpsert(rows);
    } catch (e: any) {
      console.error(`  Supabase write failed (${e?.message ?? e}); falling back to local cache.`);
      localUpsert(rows);
    }
  } else {
    localUpsert(rows);
  }
  console.error(`  recorded ${rows.length} investigated repo(s).`);
  process.exit(0);
}

main();
