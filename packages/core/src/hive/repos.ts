// HiveMind repo linking — the dependency index that makes the hive proactive.
//
// `brainblast hive link` registers a repo (path + its declared dependencies) in
// the hive, so briefs can be assembled per-stack without re-scanning, and every
// sync can answer "does this NEW trap affect anything I maintain?" (outbreak
// alerts). Four ecosystems: npm (package.json), Rust (Cargo.toml), Go (go.mod),
// Python (pyproject.toml / requirements.txt). Every extractor is deliberately
// tolerant — a malformed manifest yields an empty map, never an error, because
// the dep index is advisory context.

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadRepos, saveRepos, type HiveRepo } from "./store.ts";

function readIfExists(p: string): string | null {
  try {
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

// Declared deps from a repo's package.json (deps + devDeps — an agent writes
// integration code against both). Declared ranges are enough for matching the
// feed's SDK names; exact resolved versions can come later from lockfiles.
export function extractNpmDeps(repoDir: string): { name: string | null; deps: Record<string, string> } {
  const raw = readIfExists(resolve(repoDir, "package.json"));
  if (!raw) return { name: null, deps: {} };
  try {
    const parsed = JSON.parse(raw);
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

// Cargo.toml [dependencies] / [dev-dependencies] / [workspace.dependencies]:
// `name = "1.0"` and `name = { version = "1.0", … }` forms, section-scoped.
export function extractCargoDeps(repoDir: string): { name: string | null; deps: Record<string, string> } {
  const raw = readIfExists(resolve(repoDir, "Cargo.toml"));
  if (!raw) return { name: null, deps: {} };
  const deps: Record<string, string> = {};
  let name: string | null = null;
  let section = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sec = t.match(/^\[([^\]]+)\]/);
    if (sec) {
      section = sec[1].trim();
      continue;
    }
    if (section === "package") {
      const m = t.match(/^name\s*=\s*"([^"]+)"/);
      if (m) name = m[1];
    }
    if (/^(dependencies|dev-dependencies|build-dependencies|workspace\.dependencies)$/.test(section)) {
      const simple = t.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
      const table = t.match(/^([A-Za-z0-9_-]+)\s*=\s*\{(.*)\}/);
      if (simple) deps[simple[1]] = simple[2];
      else if (table) deps[table[1]] = table[2].match(/version\s*=\s*"([^"]+)"/)?.[1] ?? "*";
    }
  }
  return { name, deps };
}

// go.mod: the module name plus `require` deps (block and single-line forms).
export function extractGoDeps(repoDir: string): { name: string | null; deps: Record<string, string> } {
  const raw = readIfExists(resolve(repoDir, "go.mod"));
  if (!raw) return { name: null, deps: {} };
  const deps: Record<string, string> = {};
  const name = raw.match(/^module\s+(\S+)/m)?.[1] ?? null;
  let inBlock = false;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock && t === ")") {
      inBlock = false;
      continue;
    }
    const m = inBlock ? t.match(/^(\S+)\s+(\S+)/) : t.match(/^require\s+(\S+)\s+(\S+)/);
    if (m && !m[1].startsWith("//")) deps[m[1]] = m[2];
  }
  return { name, deps };
}

// Python: pyproject.toml ([project] name + dependencies list, poetry deps) and
// requirements.txt (one spec per line). Extras/markers/pins are stripped down
// to the bare package name — that's what VTI sdk names match on.
export function extractPythonDeps(repoDir: string): { name: string | null; deps: Record<string, string> } {
  const deps: Record<string, string> = {};
  let name: string | null = null;

  const spec = (s: string): [string, string] | null => {
    const m = s
      .trim()
      .replace(/^["']|["'],?$/g, "")
      .match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/);
    if (!m || !m[1] || m[1].startsWith("#") || m[1] === "python") return null;
    return [m[1].toLowerCase(), m[2].split(";")[0].trim() || "*"];
  };

  const pyproject = readIfExists(resolve(repoDir, "pyproject.toml"));
  if (pyproject) {
    name = pyproject.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? null;
    // [project] dependencies = [ "a>=1", "b[extra]==2" ] — scan to the MATCHING
    // close bracket (an extras `]` inside an entry must not terminate the block).
    const start = pyproject.search(/^\s*dependencies\s*=\s*\[/m);
    if (start >= 0) {
      let depth = 0;
      let inStr: string | null = null;
      let end = -1;
      for (let i = pyproject.indexOf("[", start); i < pyproject.length; i++) {
        const ch = pyproject[i];
        if (inStr) {
          if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'") inStr = ch;
        else if (ch === "[") depth++;
        else if (ch === "]" && --depth === 0) {
          end = i;
          break;
        }
      }
      const depsBlock = end >= 0 ? pyproject.slice(pyproject.indexOf("[", start) + 1, end) : "";
      for (const entry of depsBlock.match(/"[^"]+"|'[^']+'/g) ?? []) {
        const s = spec(entry.slice(1, -1));
        if (s) deps[s[0]] = s[1];
      }
    }
    // [tool.poetry.dependencies] name = "^1.0" lines.
    const poetry = pyproject.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
    for (const line of poetry.split("\n")) {
      const m = line.trim().match(/^([A-Za-z0-9._-]+)\s*=\s*["{]?([^"}\n]*)/);
      if (m && m[1].toLowerCase() !== "python") deps[m[1].toLowerCase()] = m[2].replace(/"/g, "").trim() || "*";
    }
  }
  const requirements = readIfExists(resolve(repoDir, "requirements.txt"));
  if (requirements) {
    for (const line of requirements.split("\n")) {
      if (line.trim().startsWith("-")) continue; // -r includes, -e editable, flags
      const s = spec(line);
      if (s) deps[s[0]] = s[1];
    }
  }
  return { name, deps };
}

// The union across ecosystems — what linking, briefs, and outbreaks key off.
export function extractRepoDeps(repoDir: string): { name: string | null; deps: Record<string, string> } {
  const npm = extractNpmDeps(repoDir);
  const cargo = extractCargoDeps(repoDir);
  const go = extractGoDeps(repoDir);
  const py = extractPythonDeps(repoDir);
  return {
    name: npm.name ?? cargo.name ?? py.name ?? go.name,
    deps: { ...go.deps, ...py.deps, ...cargo.deps, ...npm.deps },
  };
}

export interface LinkResult {
  repo: HiveRepo;
  relinked: boolean; // an existing link was refreshed rather than added
  depCount: number;
}

export function linkRepo(root: string, repoDir: string, now: string = new Date().toISOString()): LinkResult {
  const path = resolve(repoDir);
  if (!existsSync(path)) throw new Error(`hive link: directory not found: ${path}`);
  const { name, deps } = extractRepoDeps(path);
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
