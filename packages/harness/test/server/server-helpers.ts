// Shared by the server tests: a harness whose `refund` tool needs a person, clients that record what they get, and a
// wait that polls for a condition instead of sleeping a fixed time.
import { createModel, type Model } from "@buildanagent/gateway";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import {
  createDispatcher,
  createHarness,
  type DispatcherOptions,
  type InProcessClient,
  inProcessTransport,
} from "@buildanagent/harness/server";
import { createApprovals, type LoadOptions, type SessionStore } from "@buildanagent/harness/session";
import { createToolRegistry, type ToolRegistration } from "@buildanagent/harness/tools";
import type { ServerMessage, ServerRequest, SessionEntry } from "@buildanagent/protocol";
import { defineTool, hmacSigner, type ToolDefinition } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { type Backend, memoryBackend } from "../session/session-helpers.js";

export type Steps = ConstructorParameters<typeof ScriptedModel>[0];

export const scripted = (steps: Steps, chunkSize?: number) =>
  createModel({
    adapter: new ScriptedModel(steps, chunkSize === undefined ? {} : { chunkSize }),
    id: "scripted-model",
    retries: 0,
  }) as Model;

export const reply = (text: string) => ({ content: [{ type: "text" as const, text }] });
export const text = (value: string) => [{ type: "text" as const, text: value }];
export const callTool = (callId: string, name: string, input: unknown) => ({
  type: "tool_call" as const,
  callId,
  name,
  input,
});

export const SIGNER = hmacSigner({ keys: { k1: Uint8Array.from({ length: 32 }, (_, i) => i + 1) }, current: "k1" });

/** A tool that answers at once with a fixed text, recording each input it ran with. */
export function fixedTool(name: string, ran: unknown[] = []): ToolDefinition<unknown, unknown, unknown> {
  return defineTool({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async execute(input) {
      ran.push(input);
      return { content: [{ type: "text", text: `${name} done` }] };
    },
  }) as ToolDefinition<unknown, unknown, unknown>;
}

export interface Setup {
  readonly backend: Backend;
  readonly dispatcher: ReturnType<typeof createDispatcher>;
  /** How many times the dispatcher's approvals resolved, and with which answers. */
  readonly resolved: unknown[][];
  /** The inputs the `refund` tool ran with. */
  readonly refunds: unknown[];
}

/**
 * A dispatcher over a harness whose `refund` tool always asks a person, with the signer approvals need. `extra`
 * registers more tools; `options` adds dispatcher settings.
 */
export function approvalSetup(
  steps: Steps,
  extra: readonly ToolRegistration[] = [],
  options: Partial<DispatcherOptions> = {},
  backend: Backend = memoryBackend(),
): Setup {
  const registry = createToolRegistry();
  const refunds: unknown[] = [];
  registry.register({ name: "refund", source: "builtin", definition: fixedTool("refund", refunds) });
  for (const tool of extra) registry.register(tool);
  const pipeline = createPermissionPipeline(
    {
      mode: "default",
      interactive: true,
      policyVersion: "p1",
      ask: [{ tool: "refund" }],
      allow: extra.map((tool) => ({ tool: tool.name })),
    },
    registry,
  );
  const harness = createHarness({
    registry,
    model: scripted(steps),
    system: "You triage tickets.",
    pipeline,
    signer: SIGNER,
  });
  const approvals = createApprovals(harness);
  const resolved: unknown[][] = [];
  const counted: typeof approvals = {
    pending: (session) => approvals.pending(session),
    resolve: (session, resolutions, resolveOptions) => {
      resolved.push([...resolutions]);
      return approvals.resolve(session, resolutions, resolveOptions);
    },
  };
  const dispatcher = createDispatcher({ harness, ...backend, userId: "ada", approvals: counted, ...options });
  return { backend, dispatcher, resolved, refunds };
}

/** A client of `dispatcher` with every message it gets, in order. */
export function recorded(dispatcher: ReturnType<typeof createDispatcher>): {
  client: InProcessClient;
  seen: ServerMessage[];
} {
  const client = inProcessTransport(dispatcher);
  const seen: ServerMessage[] = [];
  client.onMessage((message) => seen.push(message));
  return { client, seen };
}

export const init = (client: InProcessClient, capabilities: string[] = []) =>
  client.request("initialize", { clientInfo: { name: "test", version: "0" }, capabilities });

/** Polls until `ready()` holds, yielding to the event loop between tries, and fails after five seconds. */
export async function until(ready: () => boolean, what = "the condition"): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export const settledCount = (seen: readonly ServerMessage[]) =>
  seen.filter((message) => "method" in message && message.method === "turn/settled").length;

export const settledMessages = (seen: readonly ServerMessage[]) =>
  seen.flatMap((message) => ("method" in message && message.method === "turn/settled" ? [message.params] : []));

export const requestsOf = (seen: readonly ServerMessage[], method?: ServerRequest["method"]) =>
  seen.filter(
    (message): message is ServerRequest =>
      "id" in message &&
      "method" in message &&
      (method === undefined
        ? ["approval/request", "clarification/request", "tool/call"].includes(message.method)
        : message.method === method),
  );

export const cancelsOf = (seen: readonly ServerMessage[]) =>
  seen.flatMap((message) =>
    "method" in message && message.method === "$/cancelRequest" && !("id" in message) ? [message.params.id] : [],
  );

/** The `seq` of every `entry_appended` event, in the order they came. */
export const entrySeqs = (seen: readonly ServerMessage[], session?: string) =>
  seen.flatMap((message) =>
    "method" in message &&
    message.method === "event" &&
    message.params.event.type === "entry_appended" &&
    (session === undefined || message.params.session === session)
      ? [message.params.seq]
      : [],
  );

/** A promise and the function that resolves it, for a test that holds a step until it lets it go. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * A store whose chosen loads take their entries at once and then wait for `held`, as a slow disk would, so entries
 * written meanwhile are missing from what the load yields. `blocks` picks the loads, given each one's options and how
 * many loads came before it; `taken` resolves when the first chosen load has taken its entries.
 */
export function snapshotLoads(
  store: SessionStore,
  blocks: (options: LoadOptions | undefined, count: number) => boolean,
  held: Promise<void>,
): { store: SessionStore; taken: Promise<void> } {
  let count = 0;
  let markTaken!: () => void;
  const taken = new Promise<void>((resolve) => {
    markTaken = resolve;
  });
  return {
    taken,
    store: {
      ...store,
      load(key, options) {
        if (!blocks(options, count++)) return store.load(key, options);
        return (async function* () {
          const entries: SessionEntry[] = [];
          for await (const entry of store.load(key, options)) entries.push(entry);
          markTaken();
          await held;
          yield* entries;
        })();
      },
    },
  };
}
