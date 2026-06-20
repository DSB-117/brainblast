import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { PACK_MANIFEST_FILE } from "./packs.ts";
import type { PackManifest } from "./types.ts";

// ── Protocol Pack Library (v0.7.6) ────────────────────────────────────────────
//
// brainblast ships a library of opt-in protocol packs (Jupiter, Raydium, Pyth,
// Meteora, Jito, …). Each is a self-contained directory under packs/ with a
// manifest, rules, and RED→GREEN fixtures. They are NOT loaded by default — a
// dev opts into exactly the stack they build on:
//
//   brainblast --packs jupiter,pyth .
//
// This module locates the bundled packs dir in both layouts and resolves a bare
// `--packs` token (e.g. "pyth") to the pack directory, so users name protocols,
// not paths.

function packsRoot(): string | null {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(here, "packs"), // dist/packs (npm — copied by postbuild)
    join(here, "..", "..", "..", "packs"), // src/../../../packs (dev — repo root)
    join(here, "..", "packs"), // fallback
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export interface BundledPack {
  id: string;
  dir: string;
  manifest: PackManifest;
}

export function listBundledPacks(): BundledPack[] {
  const root = packsRoot();
  if (!root) return [];
  const out: BundledPack[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    const manifestPath = join(dir, PACK_MANIFEST_FILE);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir || !existsSync(manifestPath)) continue;
    try {
      const manifest = parse(readFileSync(manifestPath, "utf8")) as PackManifest;
      if (manifest?.id) out.push({ id: manifest.id, dir, manifest });
    } catch {
      /* skip malformed manifest */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Resolve a --packs token to a bundled pack directory:
//   1. exact pack id            ("pyth-price-unchecked-staleness")
//   2. leading-segment / protocol name ("pyth" → "pyth-...") when unambiguous
//   3. substring match          when unambiguous
// Returns null when not found or ambiguous (caller decides how to report).
export function resolveBundledPackToken(token: string): string | null {
  const packs = listBundledPacks();
  const exact = packs.find((p) => p.id === token);
  if (exact) return exact.dir;
  const lead = packs.filter((p) => p.id === token || p.id.startsWith(token + "-"));
  if (lead.length === 1) return lead[0].dir;
  const sub = packs.filter((p) => p.id.includes(token));
  if (sub.length === 1) return sub[0].dir;
  return null;
}
