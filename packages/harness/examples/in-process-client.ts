// A client in the same process: it answers the server's approval request, opens a session and starts a turn.

import { tmpdir } from "node:os";
import { createModel, type Model } from "@buildanagent/gateway";
import { createDispatcher, createHarness, inProcessTransport } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore } from "@buildanagent/harness/session";
import { fileLock } from "@buildanagent/harness/session/jsonl";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";

const harness = createHarness({
  registry: createToolRegistry(),
  model: createModel({
    adapter: new ScriptedModel([{ content: [{ type: "text", text: "Hello." }] }]),
    id: "m",
    retries: 0,
  }) as Model,
  system: "You are a coding agent.",
});
const store = memoryStore();
const index = memoryIndex();
const lock = fileLock({ dir: `${tmpdir()}/in-process-client-locks` });

// #region client
const client = inProcessTransport(createDispatcher({ harness, store, index, lock, userId: "ada" }));
client.onMessage((message) => {
  // "event" and "turn/settled" notifications, and the server's requests, which carry an id.
  if ("id" in message && "method" in message && message.method === "approval/request") {
    const { id: requestId } = message.params.request;
    client.respond(message, { resolutions: [{ requestId, decision: "allow" }] });
  }
});
await client.request("initialize", { clientInfo: { name: "cli", version: "1" }, capabilities: [] });
const { session } = await client.request("session/create", { cwd: "/work" });
const disposition = await client.request("turn/start", { session, input: [{ type: "text", text: "Hi" }] });

// #endregion

export { client, disposition, session };
