// The permission evaluation order: hooks -> deny rules -> ask rules -> mode -> allow rules -> canUseTool.
// Docs: permissions.md "How permissions are evaluated"
import { createSdkMcpServer, query, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { check, collect } from "./lib/collect.ts";

const NAME = "mcp__ops__restart_service";
function setup() {
  const state = { handler: 0, canUseTool: [] as string[] };
  const server = createSdkMcpServer({
    name: "ops", version: "1.0.0",
    tools: [tool("restart_service", "Restart a service", { service: z.string() }, async () => {
      state.handler++;
      return { content: [{ type: "text", text: "restarted" }] };
    })],
  });
  const options: Options = {
    mcpServers: { ops: server }, maxTurns: 4,
    canUseTool: async (toolName) => { state.canUseTool.push(toolName); return { behavior: "allow", updatedInput: { service: "api" } }; },
  };
  return { state, options };
}

// a) Not pre-approved: falls through to canUseTool (step 6).
{
  const { state, options } = setup();
  await collect(query({ prompt: "restart the api", options }));
  check(state.canUseTool.includes(NAME), "a) unlisted tool reaches canUseTool");
  check(state.handler === 1, "a) canUseTool 'allow' lets the tool run");
}
// b) In allowedTools: approved at step 5, canUseTool never consulted, and the SDK warns.
{
  const { state, options } = setup();
  const warnings: string[] = [];
  process.on("warning", (w: any) => warnings.push(w.code));
  await collect(query({ prompt: "restart the api", options: { ...options, allowedTools: [NAME] } }));
  check(state.canUseTool.length === 0, "b) allowedTools entry bypasses canUseTool");
  check(state.handler === 1, "b) tool ran");
  check(warnings.includes("CLAUDE_SDK_CAN_USE_TOOL_SHADOWED"), "b) SDK emitted CLAUDE_SDK_CAN_USE_TOOL_SHADOWED");
}
// c) Deny rule wins even in bypassPermissions, and canUseTool is not called (step 2).
{
  const { state, options } = setup();
  await collect(query({ prompt: "restart the api", options: {
    ...options, disallowedTools: [NAME], permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true,
  } }));
  check(state.handler === 0, "c) disallowedTools blocks the tool even in bypassPermissions");
  check(state.canUseTool.length === 0, "c) denied call never reaches canUseTool");
}
// d) A PreToolUse hook can deny before any rule is checked (step 1).
{
  const { state, options } = setup();
  await collect(query({ prompt: "restart the api", options: {
    ...options, allowedTools: [NAME],
    hooks: { PreToolUse: [{ matcher: NAME, hooks: [async () => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "change freeze" },
    })] }] },
  } }));
  check(state.handler === 0, "d) PreToolUse hook 'deny' blocks a tool that allowedTools would approve");
}
// e) A hook 'allow' does not override a deny rule.
{
  const { state, options } = setup();
  await collect(query({ prompt: "restart the api", options: {
    ...options, disallowedTools: [NAME],
    hooks: { PreToolUse: [{ matcher: NAME, hooks: [async () => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    })] }] },
  } }));
  check(state.handler === 0, "e) hook 'allow' does not skip deny rules");
}
// f) dontAsk mode skips canUseTool and denies (step 6).
{
  const { state, options } = setup();
  await collect(query({ prompt: "restart the api", options: { ...options, permissionMode: "dontAsk" } }));
  check(state.canUseTool.length === 0 && state.handler === 0, "f) dontAsk denies without calling canUseTool");
}
