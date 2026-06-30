// fleet:discover — R7 autonomy, step 1–3 (deterministic).
//
// Scours npm + GitHub for popular repositories that DEPEND ON a target SDK —
// the highest-value scouting targets (real code using the SDK in the wild) —
// ranks them by stars, filters out anything the shared ledger says is already
// investigated, and writes a work list. The `brainblast-fleet` skill then fans
// out a subagent per repo to scout each one.
//
//   npm run fleet:discover -- --sdk cors [--limit 10] [--min-stars 50] [--lang typescript]
//
// Uses the authenticated `gh` CLI for the GitHub API (no token handling here) and
// the public npm registry. Output: fleet/worklist.json + a ranked table.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const fleetDir = join(repoRoot, "fleet");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const sdk = arg("sdk");
const limit = Number(arg("limit", "10"));
const minStars = Number(arg("min-stars", "0"));
const lang = arg("lang"); // optional language filter for code search

if (!sdk) {
  console.error("usage: npm run fleet:discover -- --sdk <npm-package> [--limit N] [--min-stars N] [--lang L] [--max-age-days N]");
  process.exit(2);
}
const target: string = sdk;

// gh api → JSON (throws on failure; caller handles). --paginate off by default.
function gh(path: string, params: string[] = []): any {
  const args = ["api", "-X", "GET", path, ...params.flatMap((p) => ["-f", p])];
  const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out);
}

async function npmInfo(pkg: string): Promise<{ downloads: number | null; repo: string | null }> {
  let downloads: number | null = null;
  let repo: string | null = null;
  try {
    const d = await (await fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`)).json();
    downloads = typeof d?.downloads === "number" ? d.downloads : null;
  } catch {
    /* non-fatal */
  }
  try {
    const meta = await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`)).json();
    const url: string | undefined = meta?.repository?.url ?? meta?.homepage;
    if (url) repo = url.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://");
  } catch {
    /* non-fatal */
  }
  return { downloads, repo };
}

// Already-investigated repos (shared ledger). Reads the registry's OPEN
// /api/fleet-ledger — no token, no key — defaulting to registry.brainblast.tech
// (override with FLEET_REGISTRY_URL). Falls back to a local cache if unreachable.
//
// Freshness TTL (4th griefing defense): only skip a repo investigated within
// `maxAgeDays` (default 30). Anything older is re-scoutable — so a false
// "investigated" row can suppress a repo for at most the TTL, and genuinely stale
// repos get re-scouted (freshness is the moat). Tune with --max-age-days.
async function investigatedSet(maxAgeDays: number): Promise<Set<string>> {
  const url = (process.env.FLEET_REGISTRY_URL ?? "https://registry.brainblast.tech").replace(/\/+$/, "");
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  try {
    const res = await fetch(`${url}/api/fleet-ledger`);
    if (res.ok) {
      const j = await res.json();
      const fresh = (j.repos ?? []).filter((r: any) => {
        const t = r.investigated_at ? Date.parse(r.investigated_at) : 0;
        return !Number.isFinite(t) || t >= cutoff; // keep recent; drop stale (re-scoutable)
      });
      return new Set<string>(fresh.map((r: any) => r.repo ?? r));
    }
    console.error(`  fleet-ledger: registry read ${res.status}; using local cache`);
  } catch (e: any) {
    console.error(`  fleet-ledger: registry unreachable (${e?.message ?? e}); using local cache`);
  }
  const local = join(fleetDir, "ledger-cache.json");
  if (existsSync(local)) {
    try {
      const j = JSON.parse(readFileSync(local, "utf8"));
      return new Set<string>((j.repos ?? []).map((r: any) => r.repo ?? r));
    } catch {
      /* ignore */
    }
  }
  return new Set();
}

async function main() {
  console.error(`fleet:discover — target SDK "${target}"\n`);
  const npm = await npmInfo(target);
  if (npm.downloads != null) console.error(`  npm: ${npm.downloads.toLocaleString()} downloads/month · repo: ${npm.repo ?? "—"}`);

  // Find repos that DEPEND ON the SDK by code-searching package.json manifests
  // (the closest API proxy for "downstream dependents"). NOTE: no language
  // qualifier here — manifests are JSON, so `language:typescript` would exclude
  // them; the optional --lang filters the *scouting* targets, applied below.
  let items: any[] = [];
  try {
    const res = gh("search/code", [`q=${target} in:file filename:package.json`, "per_page=50"]);
    items = res.items ?? [];
  } catch (e: any) {
    console.error(`  github code search unavailable (${e?.message ?? e}); using repo search.`);
  }
  // Augment with repo search (ecosystem repos by stars) — reliable even when code
  // search is rate-limited or sparse.
  try {
    const res = gh("search/repositories", [`q=${target} in:name,description,topics${lang ? ` language:${lang}` : ""}`, "sort=stars", "per_page=50"]);
    for (const r of res.items ?? []) items.push({ repository: r });
  } catch (e: any) {
    if (items.length === 0) {
      console.error(`  github repo search also failed: ${e?.message ?? e}`);
      process.exit(1);
    }
  }

  // Unique repos, excluding the SDK's own repo and recently-investigated ones.
  const skip = await investigatedSet(Number(arg("max-age-days", "30")));
  const ownRepo = npm.repo?.replace(/^https?:\/\/github\.com\//, "") ?? "";
  const byName = new Map<string, any>();
  for (const it of items) {
    const full = it.repository?.full_name;
    if (!full || full === ownRepo || skip.has(full)) continue;
    if (!byName.has(full)) byName.set(full, it.repository);
  }

  // Rank by stars. Code-search repo objects carry stargazers_count already; if
  // missing, one lookup each (bounded to the unique set).
  const ranked: { repo: string; stars: number; url: string }[] = [];
  for (const [full, r] of byName) {
    let stars = r.stargazers_count;
    if (typeof stars !== "number") {
      try {
        stars = gh(`repos/${full}`).stargazers_count ?? 0;
      } catch {
        stars = 0;
      }
    }
    if (stars >= minStars) ranked.push({ repo: full, stars, url: `https://github.com/${full}` });
  }
  ranked.sort((a, b) => b.stars - a.stars);
  const worklist = ranked.slice(0, limit);

  mkdirSync(fleetDir, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    sdk,
    npmDownloadsLastMonth: npm.downloads,
    discovered: byName.size,
    skippedAlreadyInvestigated: skip.size,
    worklist,
  };
  writeFileSync(join(fleetDir, "worklist.json"), JSON.stringify(out, null, 2) + "\n");

  console.error(`\n  ${byName.size} candidate repo(s); top ${worklist.length} by stars → fleet/worklist.json\n`);
  console.error("  ★ stars   repository");
  console.error("  ─────────────────────────────────────────────");
  for (const w of worklist) console.error(`  ${String(w.stars).padStart(7)}   ${w.repo}`);
  console.error(`\n  next: the brainblast-fleet skill fans out a subagent per repo to scout each one.`);
}

main();
