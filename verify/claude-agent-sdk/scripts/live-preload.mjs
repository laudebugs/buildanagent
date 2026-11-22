// Preload for a live run (node --import), which run-examples.mjs --live adds before the example's own code. The
// example runs in a network namespace with only a loopback interface, and so does the `claude` CLI that the SDK spawns.
//   1. Starts the forwarder (scripts/live/forward.mjs) to the runner's proxy, which holds the key and alone reaches
//      the provider, and points the CLI at it with ANTHROPIC_BASE_URL and a placeholder key.
//   2. Rewrites the CLI's arguments so that it offers one built-in tool, ToolSearch, whatever the example asked for
//      (`--tools=ToolSearch`, as the SDK's `tools: ["ToolSearch"]` sends). ToolSearch only looks up the session's own
//      deferred tools, and the mock transcripts' flows start with it; Bash, Read, Edit, WebFetch, Agent and the rest
//      reach the host. The proxy still refuses any request that offers one, so a CLI that ignored the flag would stop
//      the run, not run a host tool.
//   3. Refuses an MCP server that isn't the SDK's in-process kind, since a stdio server is a process on the host.
// The SDK spawns the CLI with node:child_process's spawn, imported by name; syncBuiltinESMExports() makes that name
// see the wrapper, the documented way to patch a built-in module for ES module importers.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { PLACEHOLDER_KEY, startForwarder } from "../../../scripts/live/forward.mjs";

const baseURL = await startForwarder(process.env.LIVE_PROXY_SOCKET);
process.env.ANTHROPIC_BASE_URL = baseURL;
process.env.ANTHROPIC_API_KEY = PLACEHOLDER_KEY;

/** Whether a spawn is the SDK starting the CLI: it always talks stream-json over stdio. */
const isCli = (args) =>
  Array.isArray(args) &&
  args.includes("--output-format") &&
  args.includes("--input-format") &&
  args.includes("stream-json");

/** The MCP servers the SDK passes in --mcp-config, as `--mcp-config=<json>` or `--mcp-config <json>`. */
function mcpServers(args) {
  const at = args.findIndex((arg) => arg === "--mcp-config" || arg.startsWith("--mcp-config="));
  if (at < 0) return {};
  const value = args[at].startsWith("--mcp-config=") ? args[at].slice("--mcp-config=".length) : args[at + 1];
  return JSON.parse(value).mcpServers ?? {};
}

function liveArgs(args) {
  for (const [name, server] of Object.entries(mcpServers(args))) {
    if (server?.type !== "sdk") throw new Error(`live mode: MCP server "${name}" runs outside the example's process`);
  }
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tools") i++;
    else if (!args[i].startsWith("--tools=")) out.push(args[i]);
  }
  return [...out, "--tools=ToolSearch"];
}

const spawn = childProcess.spawn;
childProcess.spawn = function liveSpawn(command, args, options) {
  if (!isCli(args)) return spawn.call(this, command, args, options);
  // An example's own `env` option replaces the CLI's environment; the proxy's address and the placeholder key win.
  const env = { ...(options?.env ?? process.env), ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_API_KEY: PLACEHOLDER_KEY };
  return spawn.call(this, command, liveArgs(args), { ...options, env });
};
syncBuiltinESMExports();
