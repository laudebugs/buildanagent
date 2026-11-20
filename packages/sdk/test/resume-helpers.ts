// Shared fixtures for the resume tests: two signer instances over one key ring, as two processes would hold, a tool
// that records each input it ran with, a spy gate, and the context rebuilt by hand from a run's stored events.
import type { Message } from "@buildanagent/gateway";
import {
  type AgentEvent,
  type Context,
  defineTool,
  hmacSigner,
  type Interceptors,
  type RunResult,
  type SignedPendingRequest,
} from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";

const KEY = new Uint8Array(32).fill(9);

/** A new signer over the shared ring, the way each process builds its own from the same stored key. */
export function processSigner() {
  return hmacSigner({ keys: { k1: new Uint8Array(KEY) }, current: "k1" });
}

/** A signer over a ring that holds a different key under the same id. */
export function otherRingSigner() {
  return hmacSigner({ keys: { k1: new Uint8Array(32).fill(1) }, current: "k1" });
}

/** A tool that records every input it ran with. */
export function recordingTool(name: string) {
  const inputs: unknown[] = [];
  const tool = defineTool({
    name,
    description: `The ${name} tool.`,
    inputSchema: {
      type: "object",
      properties: { order: { type: "integer" }, note: { type: "string" } },
      required: ["order"],
    },
    async execute(input) {
      inputs.push(input);
      return { content: [{ type: "text", text: `${name} ${JSON.stringify(input)} done` }] };
    },
  });
  return { tool, inputs };
}

/**
 * A gate that asks about every refund and adds a note to its input, so the signed input differs from the model's
 * arguments, and that records every call it is asked about.
 */
export function spyGate(): { interceptors: Interceptors; seen: string[] } {
  const seen: string[] = [];
  const interceptors: Interceptors = {
    beforeToolCall: async (e) => {
      seen.push(e.callId);
      if (e.tool !== "refund") return { decision: "allow" };
      const input = { ...(e.input as object), note: "checked by policy" };
      return { decision: "ask", input, reason: "refunds need a manager", policyVersion: "policy-3" };
    },
  };
  return { interceptors, seen };
}

/** One response holding the given tool calls. */
export function calls(...entries: [string, unknown, string][]): ScriptStep {
  return { content: entries.map(([name, input, callId]) => ({ type: "tool_call" as const, callId, name, input })) };
}

/**
 * The context a host rebuilds from its own log of the run's events, without the result's `context`: the user's
 * input, every `model_call_end` message, every `tool_call_end` result as a tool message, and every
 * `approval_request` as a pending request with its input. The JSON round-trip test and the hand-built test share
 * this run, so a field the hand-built context lacks shows up as a failing diff.
 */
export function contextFromLog(system: string, input: string, events: readonly AgentEvent[]): Context {
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: input }] }];
  const pending: SignedPendingRequest[] = [];
  const pendingInputs: Record<string, unknown> = {};
  for (const event of events) {
    if (event.type === "model_call_end") messages.push(event.message);
    if (event.type === "tool_call_end") {
      const { content, isError } = event.result;
      messages.push({ role: "tool", callId: event.callId, content: [...content], isError: isError === true });
    }
    if (event.type === "approval_request") {
      pending.push(event.request);
      pendingInputs[event.request.id] = event.input;
    }
  }
  return { system, messages, pending, pendingInputs };
}

/** A copy of `value` through JSON, as a store and a second process would see it. */
export function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The text of every tool message in `messages`, by call id. */
export function toolTexts(messages: readonly Message[]): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const message of messages) {
    if (message.role !== "tool") continue;
    texts[message.callId] = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  }
  return texts;
}

/** The pending requests of a paused result, or a failed assertion. */
export function pendingOf(result: RunResult): readonly SignedPendingRequest[] {
  if (result.stopReason !== "awaiting_approval" && result.stopReason !== "clarification_requested") {
    throw new Error(`expected a paused run, got ${result.stopReason}`);
  }
  return result.pending;
}
