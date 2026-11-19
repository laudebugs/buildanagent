import { defineConfig } from "vitest/config";

// Every test file runs after the offline setup: non-loopback fetch throws, a set provider key fails the run,
// and real model requests are off (docs/guidelines/testing.md).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["@buildanagent/gateway/testing/setup"],
  },
});
