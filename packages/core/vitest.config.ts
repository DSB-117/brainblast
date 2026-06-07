import { defineConfig } from "vitest/config";

// Only the unit suite under test/. Generated contract tests (.gen/, written by
// scripts/prove.ts) are exercised separately and must not be picked up here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts", "rules/**/*.ts"],
      exclude: ["src/cli.ts", "src/testTemplates/**"],
    },
  },
});
