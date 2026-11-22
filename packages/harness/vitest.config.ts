import { defineConfig } from "vitest/config";

// Every test file runs after the offline setup in test/setup.ts: non-loopback fetch throws, a set provider key fails
// the run, and real model requests are off (docs/guidelines/testing.md).
//
// Node tests resolve through the SSR conditions. Vite 8 replaces its defaults with this list instead of adding to
// it, so `source` (our workspace packages' src/ entries, ADR 0050) comes first and Vite's `defaultServerConditions`
// follow. `vitest/config` doesn't re-export them, so they are spelled out, and
// packages/gateway/test/vite-conditions.test.ts fails if they drift from the Vite that Vitest runs on.
export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["source", "module", "node", "development|production"],
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // `@modelcontextprotocol/client`, which the framing check reads with, reaches eventsource and eventsource-parser,
    // which ship a `source` condition too. Loaded natively, they would resolve to their src/*.ts, which Node won't strip
    // under node_modules, so Vite transforms the chain that imports them, as agent-safety's config does for `ai`.
    server: { deps: { inline: [/\/node_modules\/(@modelcontextprotocol\/[^/]+|eventsource|eventsource-parser)\//] } },
  },
});
