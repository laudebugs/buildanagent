// Cloudflare's workerd has `process.getBuiltinModule()` and `node:https` under `nodejs_compat`, but refuses the custom
// `lookup` the pinned Node connection needs, so a remote server there must go through the platform's `fetch`. This test
// runs the harness's runtime check inside workerd, through Miniflare, and in Node.
import assert from "node:assert/strict";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from "miniflare";
import { afterAll, beforeAll, test } from "vitest";
import { hasNodeNetwork } from "../../src/mcp/http-node.js";

const COMPATIBILITY_DATE = "2026-11-03"; // the pinned workerd's release date

let mf: Miniflare;

beforeAll(async () => {
  // The check reads only globals, so its own source runs inside the worker unchanged.
  const script = `
const hasNodeNetwork = ${hasNodeNetwork.toString()};
function lookupRefused() {
  try {
    const request = process.getBuiltinModule("node:http").request({ hostname: "mcp.test", lookup: () => {} });
    request.destroy();
    return false;
  } catch {
    return true;
  }
}
export default {
  async fetch() {
    return Response.json({ builtins: typeof process.getBuiltinModule, hasNodeNetwork: hasNodeNetwork(), lookupRefused: lookupRefused() });
  },
};`;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      log: new Log(LogLevel.WARN),
      modules: true,
      script,
      compatibilityDate: COMPATIBILITY_DATE,
      compatibilityFlags: ["nodejs_compat"],
    }),
  );
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

test("workerd with nodejs_compat is not taken for Node, so the platform fetch carries its requests", async () => {
  const result = (await (await mf.dispatchFetch("http://worker/")).json()) as Record<string, unknown>;
  assert.equal(result.builtins, "function", "workerd has getBuiltinModule, which the first check trusted");
  assert.equal(result.lookupRefused, true, "workerd refuses the lookup the pinned connection needs");
  assert.equal(result.hasNodeNetwork, false);
  assert.equal(hasNodeNetwork(), true, "and Node still is");
}, 60_000);
