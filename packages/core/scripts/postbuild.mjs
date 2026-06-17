// Copy data files the runtime resolves by relative path:
//   * rules/*.yaml          → dist/rules/    (bundled audit rules)
//   * programs/directory.yaml → dist/programs/ (Phase 1 trust-graph directory)
//
// dist's trustGraph/directory.ts resolves `<src>/../../programs/directory.yaml`
// at import.meta.url. In dist/ that's dist/../../programs/, so we mirror the
// repo layout one level up; instead we keep it simple and copy alongside the
// dist bundle, then the bundled loader looks at dist/../programs first.
import { mkdirSync, readdirSync, copyFileSync } from "node:fs";
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
