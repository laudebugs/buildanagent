// The offline setup for every test file (docs/guidelines/testing.md). Vitest resolves a bare `setupFiles` entry
// when it loads the config, with Node's default conditions and not `source`, so it would pick the built dist/ file,
// or fail every test file before a build. Importing it here lets Vite resolve it through `ssr.resolve.conditions`.
import "@buildanagent/gateway/testing/setup";
