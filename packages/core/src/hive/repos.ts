// HiveMind repo linking — the dependency index that makes the hive proactive.
//
// `brainblast hive link` registers a repo (path + its declared dependencies) in
// the hive, so briefs can be assembled per-stack without re-scanning, and every
// sync can answer "does this NEW trap affect anything I maintain?" (outbreak
// alerts). npm manifests today; each further ecosystem is one extractor.

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadRepos, saveRepos, type HiveRepo } from "./store.ts";

// Declared deps from a repo's package.json (deps + devDeps — an agent writes
// integration code against both). Declared ranges are enough for matching the
// feed's SDK names; exact resolved versions can come later from lockfiles.
export function extractNpmDeps(repoDir: string): { name: string | null; deps: Record<string, string> } {
  const p = resolve(repoDir, "package.json");
  if (!existsSync(p)) return { name: null, deps: {} };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    const deps: Record<string, string> = {};
    for (const section of ["dependencies", "devDependencies"]) {
      const block = parsed?.[section];
      if (block && typeof block === "object") {
        for (const [k, v] of Object.entries(block)) {
          if (typeof v === "string") deps[k] = v;
        }
      }
    }
    return { name: typeof parsed?.name === "string" ? parsed.name : null, deps };
  } catch {
    return { name: null, deps: {} };
  }
}

export interface LinkResult {
  repo: HiveRepo;
  relinked: boolean; // an existing link was refreshed rather than added
  depCount: number;
}

export function linkRepo(root: string, repoDir: string, now: string = new Date().toISOString()): LinkResult {
  const path = resolve(repoDir);
  if (!existsSync(path)) throw new Error(`hive link: directory not found: ${path}`);
  const { name, deps } = extractNpmDeps(path);
  const repo: HiveRepo = {
    path,
    name: name ?? basename(path),
    deps,
    linkedAt: now,
  };
  const state = loadRepos(root);
  const idx = state.repos.findIndex((r) => r.path === path);
  const relinked = idx >= 0;
  // A relink refreshes the dep index but keeps the original linkedAt.
  const saved = relinked ? { ...repo, linkedAt: state.repos[idx].linkedAt } : repo;
  if (relinked) state.repos[idx] = saved;
  else state.repos.push(saved);
  saveRepos(root, state);
  return { repo: saved, relinked, depCount: Object.keys(deps).length };
}

export function unlinkRepo(root: string, repoDir: string): boolean {
  const path = resolve(repoDir);
  const state = loadRepos(root);
  const before = state.repos.length;
  state.repos = state.repos.filter((r) => r.path !== path);
  if (state.repos.length === before) return false;
  saveRepos(root, state);
  return true;
}
