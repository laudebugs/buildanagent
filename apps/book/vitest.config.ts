import { defineConfig } from "vitest/config";

// Every test file runs after the repo's offline setup in test/setup.ts, as in packages/ (docs/guidelines/testing.md).
// The `source` condition comes first so the setup loads from the gateway's src/, and Vite's default server conditions
// follow, spelled out as in packages/gateway/vitest.config.ts.
export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["source", "module", "node", "development|production"],
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
