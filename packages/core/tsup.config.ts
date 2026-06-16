import { defineConfig } from "tsup";

// Build the publishable artifact.
// Entries: CLI bin, library API, and the MCP server entry.
// ts-morph, yaml, and the MCP SDK stay external (real runtime deps).
// The shebang in src/cli.ts is preserved on dist/cli.js.
// The YAML rule pack is copied into dist/rules/ by scripts/postbuild.mjs.
export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: "esm",
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: { entry: { index: "src/index.ts" } },
  external: ["ts-morph", "yaml", "@modelcontextprotocol/sdk"],
  onSuccess: "node scripts/postbuild.mjs",
});
