import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The guard that would have caught the outage: a git conflict marker (or any
// unparseable line) committed into a generated dataset silently corrupts the
// public corpus (the registry's loadDashboard/loadLots JSON.parse per line). Fail
// CI at the source instead of shipping 0 VTIs.

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

const CONFLICT_RE = /^(<{7}|={7}|>{7})/;

const JSONL_FILES = [
  "datasets/seed/seed-vti.jsonl",
  "datasets/v0.1.0/full/vti.jsonl",
  "datasets/v0.1.0/sample/vti.jsonl",
];
const JSON_FILES = [
  "datasets/corpus-index.json",
  "datasets/catalog.json",
  "datasets/sla.json",
  "datasets/seed/manifest.json",
  "datasets/v0.1.0/index.json",
];

function conflictLines(content: string): number[] {
  const out: number[] = [];
  content.split("\n").forEach((line, i) => {
    if (CONFLICT_RE.test(line)) out.push(i + 1);
  });
  return out;
}

describe("datasets integrity — no committed corruption", () => {
  for (const rel of [...JSONL_FILES, ...JSON_FILES]) {
    const path = join(repoRoot, rel);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");

    it(`${rel} has no git conflict markers`, () => {
      expect(conflictLines(content)).toEqual([]);
    });
  }

  for (const rel of JSONL_FILES) {
    const path = join(repoRoot, rel);
    if (!existsSync(path)) continue;
    it(`${rel} — every line parses as JSON`, () => {
      const bad: number[] = [];
      readFileSync(path, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (!t) return;
        try {
          JSON.parse(t);
        } catch {
          bad.push(i + 1);
        }
      });
      expect(bad).toEqual([]);
    });
  }

  for (const rel of JSON_FILES) {
    const path = join(repoRoot, rel);
    if (!existsSync(path)) continue;
    it(`${rel} — parses as JSON`, () => {
      expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
    });
  }
});
