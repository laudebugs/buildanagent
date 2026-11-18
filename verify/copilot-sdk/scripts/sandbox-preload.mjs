// Preload for every example run (node --import). It runs inside the network namespace that
// run-examples.mjs creates, before the example's own code:
//   1. Starts the mock model (scripts/mock-model.mjs) on 127.0.0.1 and exports its URL as
//      COPILOT_MOCK_URL.
//   2. Wraps CopilotClient.createSession/resumeSession so every session uses the mock as its BYOK
//      provider. A docs example's own provider (Azure, Ollama, a real API) is replaced; ours already
//      point at the mock and pass through unchanged.
//   3. Tells the mock which tools it may call: the session's custom tools whose handlers don't touch
//      the host, and tools of MCP servers that run our own fixtures. Built-ins are never callable.
//   4. Rejects non-local fetch() from the example process (the network namespace already blocks it).
import { appendFileSync } from "node:fs";
import { CopilotClient } from "@github/copilot-sdk";
import { allowTools, startMock } from "./mock-model.mjs";

const server = await startMock(0, process.env.MOCK_LOG);
server.unref();
const url = `http://127.0.0.1:${server.address().port}`;
process.env.COPILOT_MOCK_URL = url;
const note = (msg) =>
  process.env.MOCK_LOG && appendFileSync(process.env.MOCK_LOG, `${JSON.stringify({ harness: msg })}\n`);

// A handler that spawns processes or writes files must never be driven by the mock.
const HOST_EFFECTS =
  /child_process|\bspawn\w*\(|\bexec\w*\(|writeFile|appendFile|unlink|rmSync|\brm\(|mkdir|fs\.|Deno\.|process\.kill/;
const FIXTURE_MCP = /verify\/copilot-sdk\/fixtures\/mcp-[\w-]+\.mjs$/;

function prepare(config = {}) {
  const out = { ...config };
  if (out.provider?.baseUrl !== url) {
    if (out.provider || out.providers) note({ replacedProvider: out.provider?.baseUrl ?? "providers[]" });
    out.provider = { type: "anthropic", baseUrl: url, apiKey: "mock-not-a-real-key" };
    delete out.providers;
    out.model = "claude-sonnet-4.5";
  }
  out.model ??= "claude-sonnet-4.5";
  const callable = [];
  for (const t of out.tools ?? []) {
    const src = String(t.handler ?? "");
    if (t.handler && !HOST_EFFECTS.test(src) && !t.overridesBuiltInTool) callable.push(t.name);
    else note({ notCallable: t.name });
  }
  for (const [key, s] of Object.entries(out.mcpServers ?? {})) {
    const ours = [process.execPath, "node"].includes(s.command) && (s.args ?? []).some((a) => FIXTURE_MCP.test(a));
    if (ours) callable.push(`${key}-*`);
    else note({ notCallableMcp: key });
  }
  allowTools(callable);
  return out;
}

const create = CopilotClient.prototype.createSession;
CopilotClient.prototype.createSession = function (config, ...rest) {
  return create.call(this, prepare(config), ...rest);
};
const resume = CopilotClient.prototype.resumeSession;
CopilotClient.prototype.resumeSession = function (id, config, ...rest) {
  return resume.call(this, id, prepare(config), ...rest);
};

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
    return Promise.reject(new Error(`offline harness: blocked fetch to ${target.host}`));
  return realFetch(input, init);
};
