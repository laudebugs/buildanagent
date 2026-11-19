// Shared fixtures for the tool tests: a pipeline context, tool calls and assistant messages.
import type { AssistantMessage, ModelContent } from "@buildanagent/gateway";
import { emptyUsage } from "@buildanagent/gateway";
import { fixedClock } from "../src/testing/determinism.js";
import type { PipelineContext } from "../src/tools/pipeline.js";
import type { ToolCall } from "../src/tools/types.js";

export function pipelineContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    runId: "run-1",
    signal: new AbortController().signal,
    depth: 0,
    maxDepth: 2,
    clock: fixedClock("2026-11-19T12:00:00.000Z"),
    ...overrides,
  };
}

export function call(name: string, input: unknown, callId = "call-1"): ToolCall {
  return { type: "tool_call", callId, name, input };
}

export function assistant(
  calls: ToolCall[],
  stopReason: AssistantMessage["stopReason"] = "tool_calls",
): AssistantMessage {
  return {
    role: "assistant",
    content: calls,
    model: { api: "scripted", provider: "scripted", id: "scripted-model" },
    stopReason,
    usage: emptyUsage(),
    cost: { total: 0, basis: "catalog", currency: "USD" },
  };
}

/** The text of every text block, joined with newlines. */
export function textOf(content: readonly ModelContent[]): string {
  return content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}
