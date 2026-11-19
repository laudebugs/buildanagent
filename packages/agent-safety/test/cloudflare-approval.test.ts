import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from "miniflare";
import { afterAll, beforeAll, test } from "vitest";
import type { Change, Played } from "./workerd/scenario.js";

// The Worker runs in workerd, Cloudflare's runtime, through Miniflare: a real `AIChatAgent` Durable Object with
// SQLite storage, answered over its WebSocket. Every outbound request is refused, so nothing leaves the machine.
const ENTRY = fileURLToPath(new URL("./workerd/approval-agent.ts", import.meta.url));
// The date of the pinned workerd release, as in the Cloudflare verify harness.
const COMPAT_DATE = "2026-11-03";
const BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith("_")));
const KEY_RING = JSON.stringify({ current: "k1", keys: { k1: "d29ya2VyZC1hcHByb3ZhbC1rZXktMzItYnl0ZXMtLS0" } });
const REFUND = { order: 4417, amount: 250 };

// Bare Node built-ins that a dependency imports without the `node:` prefix resolve to workerd's nodejs_compat modules.
const nodeBuiltins: Plugin = {
  name: "node-builtins",
  setup(b) {
    b.onResolve({ filter: /^[a-z_/]+$/ }, (args) => {
      const name = args.path.replace(/\/$/, "");
      return BUILTINS.has(name) ? { path: `node:${name}`, external: true } : undefined;
    });
  },
};

const outDir = mkdtempSync(join(tmpdir(), "agent-safety-workerd-"));
const blocked: string[] = [];
let mf: Miniflare | undefined;

beforeAll(async () => {
  const outfile = join(outDir, "worker.mjs");
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    external: ["cloudflare:*", "node:*"],
    plugins: [nodeBuiltins],
    logLevel: "silent",
  });
  const options = {
    log: new Log(LogLevel.WARN),
    modules: true,
    scriptPath: outfile,
    modulesRoot: outDir,
    compatibilityDate: COMPAT_DATE,
    compatibilityFlags: ["nodejs_compat"],
    bindings: { APPROVAL_KEYS: KEY_RING },
    durableObjects: { RefundAgent: { className: "RefundAgent", useSQLite: true } },
    outboundService: (request: Request) => {
      blocked.push(new URL(request.url).hostname);
      return new Response("network disabled in this test", { status: 403 });
    },
  };
  mf = new Miniflare(convertV4MiniflareOptions(options as never));
  await mf.ready;
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
  rmSync(outDir, { recursive: true, force: true });
  assert.deepEqual(blocked, [], "the Worker tried to reach the network");
});

async function play(change: Change): Promise<Played> {
  assert.ok(mf, "Miniflare started");
  const response = await mf.dispatchFetch(`http://localhost/${change}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const played = JSON.parse(body) as Played;
  assert.deepEqual(played.errors, [], "no turn failed");
  return played;
}

test("in workerd, an approved call runs once after the adapter verifies its signed pause", async () => {
  const played = await play("none");
  assert.deepEqual(played.streamed, ["call_1:tool-output-available"]);
  assert.deepEqual(played.states, ["call_1:output-available"]);
  assert.deepEqual(played.executed, [REFUND]);
  assert.deepEqual(played.denials, []);
}, 30_000);

/**
 * What a client of `agents` 0.33.0 sees of a denial on resume. `ai` streams a `tool-output-denied` chunk for the call,
 * but the agent treats it as a replay, because the stored part is already `approval-responded`, so it neither stores
 * nor forwards it. The part keeps its approval until the next turn, when `settleDeniedApprovals()` marks it denied, and
 * the call never runs. The model reads the denial in the continuation turn.
 */
function assertDeniedOnCloudflare(played: Played) {
  assert.deepEqual(played.streamed, [], "no output chunk reaches the client");
  assert.deepEqual(played.states, ["call_1:approval-responded"]);
}

const TAMPERED: [Change, string][] = [
  ["signature", "signature_invalid"],
  ["key-id", "signature_invalid"],
  ["input", "input_changed"],
  ["forget", "unknown_request"],
  ["needs-approval-signature", "signature_invalid"],
];

for (const [change, cause] of TAMPERED) {
  test(`in workerd, an approval after a ${change} change runs nothing, and client and model see a denial`, async () => {
    const played = await play(change);
    assert.deepEqual(played.executed, [], "execute never ran");
    assertDeniedOnCloudflare(played);
    assert.deepEqual(played.denials, [cause]);
    assert.deepEqual(
      played.outcomes.map((outcome) => [outcome.kind, outcome.reason]),
      [["not_applied", "APPROVAL_NOT_VERIFIED"]],
    );
  }, 30_000);
}

test("in workerd, a policy change between pause and resume makes recheck deny with a not_applied outcome", async () => {
  const played = await play("policy");
  assert.deepEqual(played.executed, []);
  assertDeniedOnCloudflare(played);
  assert.deepEqual(played.denials, ["policy_denied"]);
  assert.deepEqual(
    played.outcomes.map((outcome) => [outcome.kind, outcome.reason]),
    [["not_applied", "POLICY_DENIED"]],
  );
}, 30_000);

test("in workerd, the model answers a denial with a fresh request, which runs once approved", async () => {
  const played = await play("retry-after-forget");
  assert.deepEqual(played.streamed, ["call_2:tool-output-available"]);
  // The second turn settled the first call as denied, so its history held a result for every call.
  assert.deepEqual(played.states, ["call_1:output-denied", "call_2:output-available"]);
  assert.deepEqual(played.executed, [REFUND]);
  assert.deepEqual(played.denials, ["unknown_request"]);
}, 30_000);
