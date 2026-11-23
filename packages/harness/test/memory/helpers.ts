// Shared by the memory tests: a project in a temp folder, a harness on fakeSandbox() with the memory extension and a
// scripted model, one turn of memory calls, and an injected clock that a test moves by days.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModel, type Message, type Model } from "@buildanagent/gateway";
import { composeExtensions, registerExtensionTools } from "@buildanagent/harness/extensions";
import { type MemoryExtension, type MemoryFiles, memoryExtension } from "@buildanagent/harness/memory";
import { fileMemoryFiles } from "@buildanagent/harness/memory/node";
import type { SandboxPolicy } from "@buildanagent/harness/sandbox";
import { createHarness } from "@buildanagent/harness/server";
import {
  openSession,
  runTurn,
  type SessionIndex,
  type SessionKey,
  type SessionLock,
  type SessionStore,
} from "@buildanagent/harness/session";
import { fakeSandbox } from "@buildanagent/harness/testing";
import { builtinTools, createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, type ToolResult } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterAll } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh temp folder, removed after the file's tests. */
export function tempDir(prefix = "harness-memory-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A project root with a `.git`, so it is a repository of its own. */
export function project(): string {
  const root = tempDir();
  mkdirSync(join(root, ".git"));
  return root;
}

export const DAY_MS = 86_400_000;
export const START = Date.parse("2026-11-22T09:00:00.000Z");

/** A clock a test moves forward by days. */
export function testClock(start = START) {
  let at = start;
  return {
    now: () => new Date(at),
    advance(days: number) {
      at += days * DAY_MS;
    },
  };
}

/** Wraps a file store, counting each call by kind, so a test can show that a refused path read nothing. */
export function counted(files: MemoryFiles) {
  const calls: string[] = [];
  const log = <T>(call: string, result: Promise<T>): Promise<T> => {
    calls.push(call);
    return result;
  };
  const wrapped: MemoryFiles = {
    list: () => log("list", files.list()),
    read: (name) => log(`read ${name}`, files.read(name)),
    write: (name, text) => log(`write ${name}`, files.write(name, text)),
    remove: (name) => log(`remove ${name}`, files.remove(name)),
    rename: (from, to) => log(`rename ${from} ${to}`, files.rename(from, to)),
  };

  return { files: wrapped, calls };
}

/** One tool call the scripted model makes. */
export interface Call {
  readonly name: string;
  readonly input: unknown;
}

/** A model that makes each call in its own step, then answers `Done.`. */
export function scripted(calls: readonly Call[], prefix = "c"): ScriptedModel {
  return new ScriptedModel([
    ...calls.map((call, at) => ({
      usage: {},
      content: [{ type: "tool_call" as const, callId: `${prefix}${at + 1}`, name: call.name, input: call.input }],
    })),
    { usage: {}, content: [{ type: "text" as const, text: "Done." }] },
  ]);
}

/** A tool whose output is untrusted, as a web page or an MCP server's is, which returns `text`. */
export const webTool = (text: string) =>
  defineTool({
    name: "web",
    description: "Fetches a page.",
    inputSchema: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      return { content: [{ type: "text", text }] };
    },
  });

/** The settings a test's harness runs with. */
export interface Setup {
  readonly root: string;
  readonly files: MemoryFiles;
  readonly clock: () => Date;
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly lock: SessionLock;
  /** Leaves the memory extension out, for the removability test. */
  readonly memory?: boolean;
  readonly sessionId?: string;
  readonly secrets?: readonly string[];
}

/** A harness on fakeSandbox() with the built-in tools, the untrusted `web` tool and, unless left out, memory. */
export async function harnessFor(
  setup: Setup,
  model: ScriptedModel,
  web = "A page.",
  sandboxFiles: Readonly<Record<string, string>> = {},
) {
  const policy: SandboxPolicy = { readRoots: [setup.root], writeRoots: [setup.root], network: { allow: [], deny: [] } };
  const sandbox = await fakeSandbox().provision({ root: setup.root, files: sandboxFiles }, policy);
  const registry = createToolRegistry();
  for (const tool of builtinTools(sandbox, undefined, { root: setup.root, policy })) registry.register(tool);
  registry.register({ source: "extension", name: "web", outputTrust: "untrusted", definition: webTool(web) as never });
  const memory: MemoryExtension | undefined =
    setup.memory === false
      ? undefined
      : memoryExtension({
          root: setup.root,
          files: setup.files,
          registry,
          clock: setup.clock,
          ...(setup.sessionId === undefined ? {} : { sessionId: setup.sessionId }),
          ...(setup.secrets === undefined ? {} : { secrets: setup.secrets }),
        });
  const extensions = memory === undefined ? [] : [memory];
  const { interceptors, observers } = composeExtensions(extensions);
  registerExtensionTools(registry, extensions);
  const harness = createHarness({
    registry,
    model: createModel({ adapter: model, id: "m", retries: 0 }) as Model,
    system: "You help.",
    interceptors,
    observers,
  });
  return { harness, registry, sandbox, memory };
}

/** Runs one turn of `calls` in the session `key`, and returns the model, so a test can read what it was sent. */
export async function turn(
  setup: Setup,
  key: SessionKey,
  calls: readonly Call[],
  options: { prefix?: string; web?: string; sandboxFiles?: Readonly<Record<string, string>> } = {},
) {
  const model = scripted(calls, options.prefix);
  const { harness, sandbox, memory } = await harnessFor(setup, model, options.web, options.sandboxFiles);
  const session = await openSession({ store: setup.store, index: setup.index, lock: setup.lock, key });
  const result = await runTurn(session, harness, { input: "Go." });
  await session.close();
  return { model, result, sandbox, memory };
}

/** The text of a message's text blocks, or of a tool message's. */
export const textOf = (message: Message | undefined): string =>
  message === undefined ? "" : message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");

/** The tool results the model was sent at its last call, by call id. */
export function results(model: ScriptedModel): Map<string, { text: string; isError: boolean }> {
  const found = new Map<string, { text: string; isError: boolean }>();
  for (const message of model.calls.at(-1)?.context.messages ?? []) {
    if (message.role === "tool") found.set(message.callId, { text: textOf(message), isError: message.isError });
  }
  return found;
}

/** The memory folder on disk under `root`, counted. */
export const filesAt = (root: string) => counted(fileMemoryFiles(root));
