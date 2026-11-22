// Shared by the pin and background tests: a legacy in-process server whose tools a test changes mid-session, and a
// session that runs turns through a harness with the MCP manager as its turn boundary.
import { createModel, type Model } from "@buildanagent/gateway";
import type { McpChannel, McpManager } from "@buildanagent/harness/mcp";
import type { PermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import type { ToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { KEY, memoryBackend } from "../session/session-helpers.js";

/** A Standard Schema that describes itself as `json` and accepts any value. */
export function schema(json: Record<string, unknown>) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "buildanagent-test",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  } as never;
}

const OBJECT = schema({ type: "object" });

/** A legacy server in this process. `calls` names each tool call that reached it; `sent` each method it was sent. */
export async function mutableServer(names: readonly string[]) {
  const server = new McpServer({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  const calls: string[] = [];
  const sent: string[] = [];
  const register = (name: string, description = `The ${name} tool.`) =>
    server.registerTool(name, { description, inputSchema: OBJECT }, (async () => {
      calls.push(name);
      return { content: [{ type: "text", text: `${name} ran` }] };
    }) as never);
  const tools = new Map(names.map((name) => [name, register(name)]));
  const [client, end] = InMemoryTransport.createLinkedPair();
  await server.connect(end);
  const channel = client as unknown as McpChannel;
  const send = channel.send.bind(channel);
  channel.send = async (message: object) => {
    const method = (message as { method?: unknown }).method;
    if (typeof method === "string") sent.push(method);
    return send(message);
  };
  return {
    channel,
    server,
    calls,
    sent,
    /** Adds a tool, which sends the server's list-change notice. */
    add: (name: string, description?: string) => tools.set(name, register(name, description)),
    /** Changes a tool's description, which sends the notice. */
    change: (name: string, description: string) => tools.get(name)?.update({ description }),
    remove: (name: string) => tools.get(name)?.remove(),
  };
}

type Steps = ConstructorParameters<typeof ScriptedModel>[0];

/** A session whose turns run through a harness with the manager as its turn boundary. */
export async function mcpSession(
  registry: ToolRegistry,
  manager: McpManager,
  steps: Steps,
  options: { readonly pipeline?: PermissionPipeline } = {},
) {
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const harness = createHarness({
    registry,
    model,
    system: "You call MCP tools.",
    turnBoundaries: [manager],
    ...(options.pipeline === undefined ? {} : { pipeline: options.pipeline }),
  });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  return {
    adapter,
    turn: (input: string, options: { readonly tools?: readonly string[] } = {}) =>
      runTurn(session, harness, { input, ...options }),
    async entries(): Promise<SessionEntry[]> {
      const all: SessionEntry[] = [];
      for await (const entry of backend.store.load(KEY)) all.push(entry);
      return all;
    },
  };
}

/** The tools of every request the model received, as the wire saw them. */
export const requestTools = (adapter: ScriptedModel) => adapter.calls.map((call) => call.context.tools);

/** The text of the harness's notices in the log, in order. */
export function notices(entries: readonly SessionEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.type === "message_block" && entry.origin === "harness" && entry.block.type === "text"
      ? [entry.block.text]
      : [],
  );
}
