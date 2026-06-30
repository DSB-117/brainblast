// fleet:ledger — R7 autonomy, step 6 (the shared "already-investigated" ledger).
//
// So sibling fleets don't re-scout the same repos. Records each investigated repo
// + the traps found there to the registry's OPEN /api/fleet-ledger — no token,
// no key; the server validates the submission. Defaults to
// registry.brainblast.tech (override with FLEET_REGISTRY_URL). Falls back to a
// local cache (fleet/ledger-cache.json, read by fleet:discover) if unreachable.
//
//   npm run fleet:ledger -- --record fleet/worklist.json
//   npm run fleet:ledger -- --check                       # print the investigated set

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const fleetDir = join(repoRoot, "fleet");
const cachePath = join(fleetDir, "ledger-cache.json");

const REGISTRY = (process.env.FLEET_REGISTRY_URL ?? "https://registry.brainblast.tech").replace(/\/+$/, "");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface LedgerRow {
  repo: string;
  sdk: string | null;
  traps: string[]; // promoted candidate ids found in this repo (empty = clean)
}

async function registryRecord(rows: LedgerRow[]): Promise<void> {
  const res = await fetch(`${REGISTRY}/api/fleet-ledger`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`registry write ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function registryList(): Promise<LedgerRow[]> {
  const res = await fetch(`${REGISTRY}/api/fleet-ledger`);
  if (!res.ok) throw new Error(`registry read ${res.status}`);
  return ((await res.json()).repos ?? []).map((r: any) => ({ repo: r.repo, sdk: r.sdk ?? null, traps: r.traps ?? [] }));
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

function buildRows(): LedgerRow[] {
  const wlPath = arg("record");
  if (!wlPath) {
    console.error("fleet:ledger --record needs a worklist path (fleet/worklist.json)");
    process.exit(2);
  }
  const abs = wlPath.startsWith("/") ? wlPath : join(repoRoot, wlPath.replace(/^(\.\.\/)+/, ""));
  const wl = JSON.parse(readFileSync(abs, "utf8"));
  return (wl.worklist ?? []).map((w: any) => ({ repo: w.repo, sdk: wl.sdk ?? null, traps: w.traps ?? [] }));
}

async function main() {
  console.error(`fleet:ledger — shared registry ${REGISTRY} (open; local cache on failure)\n`);

  if (process.argv.includes("--check")) {
    let rows: LedgerRow[];
    try {
      rows = await registryList();
    } catch (e: any) {
      console.error(`  registry read failed (${e?.message ?? e}); showing local cache.`);
      rows = localList();
    }
    console.error(`  ${rows.length} repo(s) on record:`);
    for (const r of rows.slice(0, 50)) console.error(`    ${r.repo}${r.traps.length ? `  → ${r.traps.join(", ")}` : "  (clean)"}`);
    process.exit(0);
  }

  const rows = buildRows();
  try {
    await registryRecord(rows);
    console.error(`  recorded ${rows.length} investigated repo(s) to the shared ledger.`);
  } catch (e: any) {
    console.error(`  registry write failed (${e?.message ?? e}); saved to local cache instead.`);
    localUpsert(rows);
  }
  process.exit(0);
}

main();
