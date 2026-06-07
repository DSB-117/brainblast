import { defineConfig } from "tsup";

// Build the publishable artifact. Two entries: the `brainblast` CLI bin and the
// library API. ts-morph and yaml stay external (real runtime deps). The shebang
// in src/cli.ts is preserved on dist/cli.js. The YAML rule pack is copied into
// dist/rules/ by scripts/postbuild.mjs (rules/index.ts resolves it there).
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: "esm",
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: { entry: { index: "src/index.ts" } },
  external: ["ts-morph", "yaml"],
  onSuccess: "node scripts/postbuild.mjs",
});
