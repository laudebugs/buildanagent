// The offline setup for every test file (docs/guidelines/testing.md). Vitest resolves a bare `setupFiles` entry
// when it loads the config, with Node's default conditions and not `source`, so it would pick the built dist/ file,
// or fail every test file before a build. Importing it here lets Vite resolve it through `ssr.resolve.conditions`, which
// reach src/ first.
import "@buildanagent/gateway/testing/setup";
import { afterEach } from "vitest";
import { assertDeclaredEvents } from "./event-check.js";

// The emitted-against-declared check (agent-SDK guide §5): a run that emits an undeclared event type fails its test.
afterEach(() => {
  assertDeclaredEvents();
});
