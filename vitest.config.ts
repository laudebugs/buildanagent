import { defineConfig } from "vitest/config";

// Running Vitest from the repo root uses each package's and app's own config, so the offline setup in its setupFiles
// always runs (docs/guidelines/testing.md). The verify/* harnesses keep their own runners.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
});
