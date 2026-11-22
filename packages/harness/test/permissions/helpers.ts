// Shared by the permission tests: a registry of small tools and a session that keeps what is appended to it.

import type {
  PermissionConfig,
  PolicyInput,
  PolicySession,
  RecordedEntry,
  ToolCall,
} from "@buildanagent/harness/permissions";
import { createToolRegistry, type ToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";

export interface Recorded extends PolicySession {
  readonly entries: RecordedEntry[];
}

export function recorder(): Recorded {
  const entries: RecordedEntry[] = [];
  return {
    entries,
    async append(entry) {
      entries.push(entry);
    },
  };
}

export function tool(name: string, run?: () => void) {
  return defineTool({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: true },
    async execute() {
      run?.();
      return { content: [{ type: "text", text: `${name} ran` }] };
    },
  });
}

/** A registry with the tools the tests use: the built-ins, an MCP tool and a tool with an alias. */
export function registryOf(names: readonly string[] = ["read", "write", "edit", "bash", "grep", "glob"]): ToolRegistry {
  const registry = createToolRegistry();
  for (const name of names) registry.register({ name, source: "builtin", definition: tool(name) });
  registry.register({ name: "search", source: "mcp:github", definition: tool("search") });
  registry.register({ name: "web_fetch", alias: "fetch", source: "extension", definition: tool("web_fetch") });
  return registry;
}

export function call(tool: string, input: unknown = {}, callId = "c1"): ToolCall {
  return { callId, tool, input, initiator: "model" };
}

export function input(session: PolicySession = recorder()): PolicyInput {
  return { session, hostContext: { user: "ada" }, entries: [] };
}

export const base = { mode: "default", interactive: true, policyVersion: "p1" } as const satisfies PermissionConfig;

/** The result of a resolve that answered a turn's requests, which a test asserts is not a code call's. */
export function asTurn<T extends object>(result: T): Exclude<T, { status: unknown }> {
  if ("status" in result) throw new Error("expected a turn's result, and the resolve returned a code call's");
  return result as Exclude<T, { status: unknown }>;
}
