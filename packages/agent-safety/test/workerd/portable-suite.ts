// The Worker that runs the package's portable tests in workerd, for test/workerd-suite.test.ts. Each test file below
// imports "vitest", which the bundle points at ./mini-vitest.ts, so the file registers its tests as it loads. A request
// runs them all and answers with each one's name and error. `test/workerd-suite.test.ts` lists the files that are not
// here and why.
import "../ai-adapter.test.js";
import "../ai-approval.test.js";
import "../ai-effects.test.js";
import "../cost-guard.test.js";
import "../effects.test.js";
import "../examples.test.js";
import "../gateway-token.test.js";
import "../hash.test.js";
import "../outcome-types.test.js";
import "../pending-types.test.js";
import "../plan-approval.test.js";
import "../run-plan.test.js";
import "../stores/memory.test.js";
import { runRegistered } from "./mini-vitest.js";

// workerd loads a module Worker's handlers from its default export.
// biome-ignore lint/style/noDefaultExport: a module Worker must export its fetch handler as the default.
export default {
  async fetch(): Promise<Response> {
    return Response.json(await runRegistered());
  },
};
