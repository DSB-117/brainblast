// Copy the YAML rule pack into dist/rules/ so the bundled rules/index resolver
// finds it at runtime (it checks <dir>/rules/ when the *.yaml aren't beside it).
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
