// The pure part of the live preload (live-preload.mjs): which spawn is the SDK starting the CLI, which MCP servers its
// arguments configure, and the arguments a live run gives the CLI. It is a module of its own so a test can run it.

/** Whether a spawn is the SDK starting the CLI: it always talks stream-json over stdio. */
export const isCli = (args) =>
  Array.isArray(args) &&
  args.includes("--output-format") &&
  args.includes("--input-format") &&
  args.includes("stream-json");

/**
 * Every MCP config the SDK passes, as `--mcp-config=<json>` or `--mcp-config <json>`. A config that is not inline
 * JSON, such as a file path, can't be inspected, so it stops the run like a server outside the example's process.
 */
export function mcpServers(args) {
  const servers = [];
  args.forEach((arg, at) => {
    if (arg !== "--mcp-config" && !arg.startsWith("--mcp-config=")) return;
    const value = arg.startsWith("--mcp-config=") ? arg.slice("--mcp-config=".length) : args[at + 1];
    let config;
    try {
      config = JSON.parse(value);
    } catch {
      throw new Error("live mode: an MCP config that is not inline JSON can't be checked");
    }
    // Entries, not an object, so a later server of the same name can't hide an earlier one.
    servers.push(...Object.entries(config?.mcpServers ?? {}));
  });
  return servers;
}

export function liveArgs(args) {
  for (const [name, server] of mcpServers(args)) {
    if (server?.type !== "sdk") throw new Error(`live mode: MCP server "${name}" runs outside the example's process`);
  }
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tools") i++;
    else if (!args[i].startsWith("--tools=")) out.push(args[i]);
  }
  return [...out, "--tools=ToolSearch"];
}
