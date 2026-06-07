import { defineConfig } from "vitest/config";

// Used ONLY by scripts/prove.ts to run generated behavioral contract tests in
// .gen/. Kept separate from vitest.config.ts (which scopes `npm test` to test/)
// so the unit run and the generated-contract run never collide.
export default defineConfig({
  test: { include: [".gen/**/*.test.ts"] },
});
