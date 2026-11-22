// Which tools a live request from the `claude` CLI may offer (scripts/live/proxy.mjs). live-preload.mjs turns off
// every built-in but ToolSearch, so a request offers the example's own MCP tools, which the SDK runs in the example's
// process, and three built-ins that do nothing on the host: ToolSearch, which looks up deferred tools, the placeholder
// that keeps deferred loading on, and the structured-output answer. Any other name means something went wrong.

/** The CLI's built-ins a live request may offer. */
export const LIVE_BUILT_INS = ["ToolSearch", "DeferredToolPlaceholder", "StructuredOutput"];

/** Whether a live request may offer the tool `name`. */
export const liveTool = (name) => name.startsWith("mcp__") || LIVE_BUILT_INS.includes(name);
