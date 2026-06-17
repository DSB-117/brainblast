import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse } from "yaml";
import type { OnChainProgram } from "./types.ts";

// Lazy-load the curated directory exactly once per process. The YAML lives at
// programs/directory.yaml and is the only human-authored source of trust-graph
// facts; everything else is RPC-probed or research-derived.
let cache: Map<string, OnChainProgram> | null = null;

function bundledPath(): string {
  // Resolves to programs/directory.yaml in both layouts:
  //   * src/ (tsx)  → here=packages/core/src/trustGraph/ → ../../programs/
  //   * dist/ (npm) → here=packages/core/dist/           → ./programs/ (postbuild copy)
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(here, "programs", "directory.yaml"), // dist/programs/directory.yaml
    join(here, "..", "..", "programs", "directory.yaml"), // src/../../programs/
    join(here, "..", "programs", "directory.yaml"), // fallback
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Return the first candidate so the caller's error names a real path.
  return candidates[0];
}

export function loadDirectory(path: string = bundledPath()): Map<string, OnChainProgram> {
  if (cache && path === bundledPath()) return cache;
  const raw = parse(readFileSync(path, "utf8")) as { programs?: OnChainProgram[] };
  if (!raw || !Array.isArray(raw.programs)) {
    throw new Error(`invalid program directory at ${path}: missing 'programs' array`);
  }
  const m = new Map<string, OnChainProgram>();
  for (const p of raw.programs) {
    if (!p.programId || !p.name) throw new Error(`directory entry missing programId/name: ${JSON.stringify(p)}`);
    if (m.has(p.programId)) throw new Error(`directory has duplicate programId ${p.programId}`);
    // Stamp provenance so the renderer can show where this came from.
    m.set(p.programId, { ...p, provenance: { ...(p.provenance ?? {}), directoryFile: path } });
  }
  if (path === bundledPath()) cache = m;
  return m;
}

// Reset for tests.
export function _resetDirectoryCache() {
  cache = null;
}
