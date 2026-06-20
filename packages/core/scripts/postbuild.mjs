// Copy data files the runtime resolves by relative path:
//   * rules/*.yaml          → dist/rules/    (bundled audit rules)
//   * programs/directory.yaml → dist/programs/ (Phase 1 trust-graph directory)
//
// dist's trustGraph/directory.ts resolves `<src>/../../programs/directory.yaml`
// at import.meta.url. In dist/ that's dist/../../programs/, so we mirror the
// repo layout one level up; instead we keep it simple and copy alongside the
// dist bundle, then the bundled loader looks at dist/../programs first.
import { mkdirSync, readdirSync, copyFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";

mkdirSync("dist/rules", { recursive: true });
let n = 0;
for (const f of readdirSync("rules")) {
  if (f.endsWith(".yaml") || f.endsWith(".yml")) {
    copyFileSync(join("rules", f), join("dist/rules", f));
    n++;
  }
}
console.log(`postbuild: copied ${n} rule file(s) -> dist/rules`);

mkdirSync("dist/programs", { recursive: true });
let p = 0;
for (const f of readdirSync("programs")) {
  if (f.endsWith(".yaml") || f.endsWith(".yml")) {
    copyFileSync(join("programs", f), join("dist/programs", f));
    p++;
  }
}
console.log(`postbuild: copied ${p} program directory file(s) -> dist/programs`);

// Protocol Pack Library (v0.7.6): ship the bundled packs so `npx brainblast
// --packs jupiter,pyth` resolves them from the installed package. The packs live
// at the repo root (../../packs relative to packages/core); copy the tree into
// dist/packs, which bundledPacks.ts resolves at import.meta.url.
const packsSrc = join("..", "..", "packs");
if (existsSync(packsSrc)) {
  cpSync(packsSrc, "dist/packs", { recursive: true });
  const packCount = readdirSync("dist/packs").length;
  console.log(`postbuild: copied ${packCount} bundled pack(s) -> dist/packs`);
}
