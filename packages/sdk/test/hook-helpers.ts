// Shared fixtures for the hook tests: runs with interceptors, and tools that record their calls.
import type { AssistantMessage, Message } from "@buildanagent/gateway";
import { defineTool, type Interceptors, type Run, type RunOptions, run, type ToolDefinition } from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { determinism, drive, scripted } from "./run-helpers.js";

export const SYSTEM = "You look up orders.";

/** Starts a scripted run with the interceptors and any further options, and returns it with its model's adapter. */
export function hookedRun(
  steps: ScriptStep[],
  interceptors: Interceptors,
  options: Partial<RunOptions> = {},
): { adapter: ReturnType<typeof scripted>["adapter"]; started: Run } {
  const { adapter, model } = scripted(steps);
  const started = run({ model, system: SYSTEM, input: "Go.", interceptors, ...determinism(), ...options });
  return { adapter, started };
}

/** Starts the run and drives it to its end. */
export async function drivenRun(steps: ScriptStep[], interceptors: Interceptors, options: Partial<RunOptions> = {}) {
  const { adapter, started } = hookedRun(steps, interceptors, options);
  return { adapter, ...(await drive(started)) };
}

/** A tool that records the inputs it executes with. */
export function recorder(name: string, exposure: "direct" | "deferred" | "hidden" = "direct") {
  const inputs: unknown[] = [];
  const tool = defineTool({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
    exposure,
    async execute(input) {
      inputs.push(input);
      return { content: [{ type: "text", text: `${name} ran with ${JSON.stringify(input)}` }] };
    },
  }) as ToolDefinition<unknown, unknown>;
  return { tool, inputs };
}

/** The names of the tools a recorded request sent. */
export function sentTools(request: { readonly context: { readonly tools: readonly { readonly name: string }[] } }) {
  return request.context.tools.map((tool) => tool.name);
}

/** The text of the first block of the last message of a request, which the tests use to see what was sent. */
export function lastText(messages: readonly Message[]): string {
  const last = messages.at(-1);
  const block = last?.content[0];
  return block?.type === "text" ? block.text : "";
}

/** The assistant message `message` with its tool call's input replaced. */
export function withInput(message: AssistantMessage, input: unknown): AssistantMessage {
  return {
    ...message,
    content: message.content.map((block) => (block.type === "tool_call" ? { ...block, input } : block)),
  };
}
