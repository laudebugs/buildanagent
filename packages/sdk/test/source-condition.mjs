// Preloaded with `--import` into each book example that test/book-examples.test.ts runs. It resolves our own
// workspace packages through their `source` export condition, so an example runs on src/ with no build, as the tests
// do (ADR 0050). It adds the condition for `@buildanagent/*` only: a third-party package may also declare `source`,
// pointing at files its published tarball leaves out, as pi-schema 1.5.2 does.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@buildanagent/")) return nextResolve(specifier, context);
    return nextResolve(specifier, { ...context, conditions: ["source", ...context.conditions] });
  },
});
