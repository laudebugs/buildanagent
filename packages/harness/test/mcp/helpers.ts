// Shared by the MCP tests: configs for the two fixture servers run as stdio children, a call log the servers append
// to, and a turn run with a scripted model, the registry's tool search and, when given, a pipeline and context policy.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModel, type Model } from "@buildanagent/gateway";
import type { ContextPolicy } from "@buildanagent/harness/context";
import type { McpServerConfig, McpStdioTransport } from "@buildanagent/harness/mcp";
import type { PermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { type ToolRegistry, toolSearchInterceptors, toolSearchTool } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterAll } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const packageDir = fileURLToPath(new URL("../..", import.meta.url));
const scripts = {
  library: fileURLToPath(new URL("./library-server.ts", import.meta.url)),
  raw: fileURLToPath(new URL("./raw-server.ts", import.meta.url)),
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh folder for one test's call log or marker files, removed after the test file. */
export function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-mcp-"));
  dirs.push(dir);
  return dir;
}

/** A path a fixture server appends its received calls to, and a reader for what it wrote. */
export function callLog(): { path: string; read(): { tool?: string; method?: string; name?: string }[] } {
  const path = join(scratchDir(), "calls.jsonl");
  return {
    path,
    read() {
      let text = "";
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return [];
      }
      return text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line));
    },
  };
}

/** A stdio config that runs one of the fixture scripts through tsx. */
export function stdioServer(
  name: string,
  script: keyof typeof scripts,
  args: readonly string[],
  overrides: Partial<Omit<McpServerConfig, "name" | "transport">> & { transport?: Partial<McpStdioTransport> } = {},
): McpServerConfig {
  const { transport, ...rest } = overrides;
  return {
    name,
    transport: {
      kind: "stdio",
      command: process.execPath,
      args: ["--import", "tsx", scripts[script], ...args],
      cwd: packageDir,
      ...transport,
    },
    ...rest,
  };
}

/** Whether a process with this id is still running. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until `check` passes or `ms` pass, polling every 20 ms. */
export async function eventually(check: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

type Steps = ConstructorParameters<typeof ScriptedModel>[0];

/** One model step that calls `tool` with `input`. */
export const callStep = (callId: string, tool: string, input: unknown = {}) => ({
  content: [{ type: "tool_call" as const, callId, name: tool, input }],
});

export const doneStep = { content: [{ type: "text" as const, text: "Done." }] };

/**
 * Runs one turn with the registry's tools, every MCP tool already activated through tool search, and the pipeline and
 * context policy when given. The registry must not hold `tool_search` yet.
 */
export async function runMcpTurn(
  registry: ToolRegistry,
  steps: Steps,
  options: { readonly pipeline?: PermissionPipeline; readonly context?: ContextPolicy } = {},
) {
  const activated = new Set(registry.list().map((tool) => tool.canonicalName));
  registry.register({ name: "tool_search", source: "builtin", definition: toolSearchTool(registry, { activated }) });
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const harness = createHarness({
    registry,
    model,
    system: "You call MCP tools.",
    interceptors: toolSearchInterceptors(registry, activated),
    ...(options.pipeline === undefined ? {} : { pipeline: options.pipeline }),
    ...(options.context === undefined ? {} : { context: options.context }),
  });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  const result = await runTurn(session, harness, { input: "Use the tools." });
  const entries: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) entries.push(entry);
  return { adapter, entries, result };
}

/** The text of every tool result the turn stored, by call id. */
export function toolResults(entries: readonly SessionEntry[]): Map<string, { text: string; isError: boolean }> {
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const entry of entries) {
    if (entry.type !== "tool_result") continue;
    const text = entry.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    results.set(entry.callId, { text, isError: entry.isError === true });
  }
  return results;
}
