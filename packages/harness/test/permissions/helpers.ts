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

/**
 * Returns a signature that differs from `signature` in its first character. That character carries the top six
 * bits of the first decoded byte, so the decoded signature always changes. Throws if the value comes back unchanged.
 *
 * Rewriting the last two characters to `AA` failed about once in 1,024 runs, because the signature already ended
 * in `AA`. A 32-byte MAC encodes to 43 characters. The next-to-last character takes 64 values, so `A` is 1 in 64.
 * The last holds four data bits and two zero bits, so it takes 16 values, and `A` is 1 in 16.
 */
export function tamper(signature: string): string {
  const changed = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  if (changed === signature) throw new Error("the tamper left the signature unchanged");
  return changed;
}
