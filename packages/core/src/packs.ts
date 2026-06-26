import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { loadRules } from "./loadRules.ts";
import type { PackManifest, Rule } from "./types.ts";

export const PACK_MANIFEST_FILE = "brainblast-pack.yaml";

// A safe identifier for use as a filesystem path segment. Pack ids and rule ids
// become directory names (e.g. fixtures/<rule-id>/, starters/<trap-id>/), so an
// id containing a slash or "../" could traverse out of the intended directory
// once we accept untrusted third-party / contributed packs (Stage 2). Bundled
// ids already conform; this just makes the invariant enforced, not assumed.
export const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 128 && SAFE_ID_RE.test(id);
}

// Validate a pack manifest. This is the safety net for third-party packs:
// a malformed manifest is rejected at load time, never silently run.
export function validatePackManifest(m: any, file: string): void {
  const errs: string[] = [];
  if (!m || typeof m !== "object") {
    throw new Error(`invalid pack manifest in ${file}: not a mapping`);
  }
  if (!m.id || typeof m.id !== "string") errs.push("missing id");
  else if (!isSafeId(m.id)) errs.push(`unsafe id ${JSON.stringify(m.id)} — must match ${SAFE_ID_RE}`);
  if (!m.name || typeof m.name !== "string") errs.push("missing name");
  if (!m.version || typeof m.version !== "string") errs.push("missing version");
  if (!m.author || typeof m.author !== "string") errs.push("missing author");
  if (errs.length) throw new Error(`invalid pack manifest in ${file}: ${errs.join("; ")}`);
}

// Load a single rule pack from `dir`: a `brainblast-pack.yaml` manifest plus
// a `rules/*.yaml` directory of pure-data Rule facts (same format/validation
// as bundled rules). Every loaded rule is stamped with `pack: {id, version,
// author}` so downstream consumers (telemetry, registry) can attribute it.
export function loadPack(dir: string): { manifest: PackManifest; rules: Rule[] } {
  const manifestPath = join(dir, PACK_MANIFEST_FILE);
  const raw = parse(readFileSync(manifestPath, "utf8"));
  validatePackManifest(raw, manifestPath);
  const manifest = raw as PackManifest;

  const rulesDir = join(dir, "rules");
  const rules = existsSync(rulesDir)
    ? loadRules(rulesDir).map((r) => ({
        ...r,
        pack: { id: manifest.id, version: manifest.version, author: manifest.author },
      }))
    : [];

  return { manifest, rules };
}

// Discover and load every pack under `packsDir` (one subdirectory per pack,
// each containing brainblast-pack.yaml). Used for a project's
// `.agent-research/packs/` directory.
export function loadPacksFromDir(packsDir: string): { manifest: PackManifest; rules: Rule[] }[] {
  if (!existsSync(packsDir)) return [];
  const out: { manifest: PackManifest; rules: Rule[] }[] = [];
  for (const entry of readdirSync(packsDir).sort()) {
    const dir = join(packsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (!existsSync(join(dir, PACK_MANIFEST_FILE))) continue;
    out.push(loadPack(dir));
  }
  return out;
}
