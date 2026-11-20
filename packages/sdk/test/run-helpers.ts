// Shared fixtures for the loop tests: a scripted model behind createModel(), deterministic run options, tool-call
// scripts and a driver that collects a run's events for the emitted-against-declared check.
import { type ContentBlock, createModel, type Model, type ModelMiddleware } from "@buildanagent/gateway";
import { type AgentEvent, defineTool, type RunResult } from "@buildanagent/sdk";
import { fixedClock, ScriptedModel, type ScriptStep, sequentialIds } from "@buildanagent/sdk/testing";
import { recordEventTypes } from "./event-check.js";

export const START = "2026-11-19T12:00:00.000Z";

/** A scripted model wrapped by createModel(), as a run receives it, with retries off unless a test asks. */
export function scripted(
  steps: ScriptStep[],
  options: { retries?: number; middleware?: ModelMiddleware[] } = {},
): { adapter: ScriptedModel; model: Model } {
  const adapter = new ScriptedModel(steps, { idGenerator: sequentialIds("call") });
  const model = createModel({
    adapter,
    id: "scripted-model",
    retries: options.retries ?? 0,
    sleep: async () => undefined,
    ...(options.middleware === undefined ? {} : { middleware: options.middleware }),
  });
  return { adapter, model };
}

/** The deterministic run options every test shares. */
export function determinism() {
  return { clock: fixedClock(START, 1000), idGenerator: sequentialIds("run") };
}

/** One response that calls `name` with `input`. */
export function toolCall(name: string, input: unknown, callId = ""): { content: ContentBlock[] } {
  return { content: [{ type: "tool_call", callId, name, input }] };
}

/** One response of plain text. */
export function text(value: string): { content: ContentBlock[] } {
  return { content: [{ type: "text", text: value }] };
}

/** A read-only tool that echoes its `order` input. */
export const lookup = defineTool({
  name: "lookup",
  description: "Look up an order.",
  inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
  async execute(input) {
    return { content: [{ type: "text", text: `order ${JSON.stringify(input)} is shipped` }] };
  },
});

/** What `drive()` needs of a run: its events, and its result. */
export interface Started<S> extends AsyncIterable<AgentEvent> {
  readonly result: Promise<RunResult<S>>;
}

/** Iterates the run to its end, records its event types for the teardown check, and returns events and result. */
export async function drive<S>(started: Started<S>): Promise<{ events: AgentEvent[]; result: RunResult<S> }> {
  const events: AgentEvent[] = [];
  for await (const event of started) events.push(event);
  recordEventTypes(events);
  return { events, result: await started.result };
}

/** The types of `events`, in order. */
export function typesOf(events: readonly AgentEvent[]): string[] {
  return events.map((event) => event.type);
}
