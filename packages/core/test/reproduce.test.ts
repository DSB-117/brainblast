import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reproducePair } from "../src/contrib/ingest.ts";
import { loadPack } from "../src/packs.ts";
import type { Rule } from "../src/types.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const PACK = "metaplex-nft-royalty-zero";
const fixtures = join(repoRoot, "packs", PACK, "fixtures", PACK);
function rule(): Rule {
  return loadPack(join(repoRoot, "packs", PACK)).rules.find((r) => r.id === PACK)!;
}
const vulnerable = readFileSync(join(fixtures, "vulnerable", "mint.ts"), "utf8");
const fixed = readFileSync(join(fixtures, "fixed", "mint.ts"), "utf8");

describe("reproducePair (corpus SLA primitive)", () => {
  it("a real VTI's stored snippets still reproduce RED→GREEN", async () => {
    expect(await reproducePair(rule(), vulnerable, fixed, "mint.ts")).toEqual({ red: true, green: true });
  });

  it("flags decay/tamper: a fixed snippet on the vulnerable side fails RED", async () => {
    const res = await reproducePair(rule(), fixed, fixed, "mint.ts");
    expect(res.red).toBe(false);
  });

  it("flags a regressed fix: the vulnerable snippet on the fixed side fails GREEN", async () => {
    const res = await reproducePair(rule(), vulnerable, vulnerable, "mint.ts");
    expect(res.green).toBe(false);
  });
});
