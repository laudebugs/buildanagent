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

/** Every value of a flag, written `--name=value` or `--name value`. */
function flagValues(args, name) {
  const values = [];
  args.forEach((arg, at) => {
    if (arg === name) values.push(args[at + 1] ?? "");
    else if (arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
  });
  return values;
}

/** The arguments without a flag, with its value. */
function withoutFlag(args, name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) i++;
    else if (!args[i].startsWith(`${name}=`)) out.push(args[i]);
  }
  return out;
}

/**
 * The arguments a live run gives the CLI. The CLI loads project and user settings, plugins and MCP servers from
 * the host's files, and those run hooks and stdio servers as processes on the host, so a live run refuses any example
 * that asks for them and tells the CLI to load none: no setting sources, and only the MCP servers the arguments name.
 * It offers one built-in tool, ToolSearch.
 */
export function liveArgs(args) {
  for (const [name, server] of mcpServers(args)) {
    if (server?.type !== "sdk") throw new Error(`live mode: MCP server "${name}" runs outside the example's process`);
  }
  if (flagValues(args, "--setting-sources").some((value) => value.trim() !== "")) {
    throw new Error("live mode: the example loads settings from the host, which can run hooks, plugins and servers");
  }
  for (const flag of ["--plugin-dir", "--settings"]) {
    if (flagValues(args, flag).length > 0)
      throw new Error(`live mode: the example passes ${flag}, which runs host code`);
  }
  let out = args;
  for (const flag of ["--tools", "--setting-sources"]) out = withoutFlag(out, flag);
  return [
    ...out.filter((arg) => arg !== "--strict-mcp-config"),
    "--strict-mcp-config",
    "--setting-sources=",
    "--tools=ToolSearch",
  ];
}

/** Names the CLI keeps from the environment the SDK built, besides the SDK's own `CLAUDE_*` variables. */
const KEPT_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "NO_PROXY", "no_proxy"];

/**
 * The CLI's environment in a live run: the names it needs and the SDK's own `CLAUDE_*` variables from `source`, then
 * the proxy's address and the placeholder key. Nothing else in the example's environment reaches the CLI.
 */
export function cliEnv(source, baseURL, placeholderKey) {
  const env = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && (KEPT_ENV.includes(name) || name.startsWith("CLAUDE_"))) env[name] = value;
  }
  return { ...env, ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_API_KEY: placeholderKey };
}
