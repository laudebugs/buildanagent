// Pi's side of the transcript recorder (scripts/transcripts/). When the runner preloads the recorder, faux.ts wraps
// each scripted step of the faux provider with recordedSteps(), so each request and answer joins the example's
// transcript, and this file wraps the session methods that start a run, so those events carry the example line of the
// call; otherwise both do nothing. A wrapped step returns the same message the scripted step does.
import type { AssistantMessage, FauxResponseStep, Message as PiMessage } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  type Message,
  modelNames,
  type Part,
  record,
  recordCallers,
  recording,
  toolCallIds,
} from "../../../../scripts/transcripts/events.ts";

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };

function partOf(block: Block): Part {
  if (block.type === "text") return { type: "text", text: block.text ?? "" };
  if (block.type === "thinking") return { type: "reasoning", text: block.thinking ?? "" };
  if (block.type === "toolCall") {
    return { type: "tool-call", id: block.id ?? "", name: block.name ?? "", input: block.arguments };
  }
  const { type, ...value } = block;
  return { type: "other", kind: type, value };
}

const partsOf = (content: string | Block[]): Part[] =>
  typeof content === "string" ? [{ type: "text", text: content }] : content.map(partOf);

/** One Pi message as a transcript message; a system message keeps its text and the names of its prompt sections. */
function messageOf(message: PiMessage): Message {
  switch (message.role) {
    case "system": {
      const sections = Object.keys(message.sections ?? {});
      return {
        role: "system",
        parts: [
          ...partsOf(message.content as string | Block[]),
          ...(sections.length > 0 ? [{ type: "other" as const, kind: "sections", value: sections }] : []),
        ],
      };
    }
    case "user":
      return { role: "user", parts: partsOf(message.content as string | Block[]) };
    case "assistant":
      return { role: "assistant", parts: partsOf(message.content as Block[]) };
    case "toolResult":
      return {
        role: "tool",
        parts: [
          {
            type: "tool-result",
            id: message.toolCallId,
            name: message.toolName,
            output: partsOf(message.content as Block[])
              .map((part) => ("text" in part ? part.text : ""))
              .join(""),
            ...(message.isError ? { error: true as const } : {}),
          },
        ],
      };
  }
}

/** The tools a request offers: those its system messages add, less those they remove, in order. */
function toolsOf(messages: readonly PiMessage[]): string[] {
  const tools: string[] = [];
  for (const message of messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsRemoved ?? []) {
      const at = tools.indexOf(tool.name);
      if (at !== -1) tools.splice(at, 1);
    }
    for (const tool of message.toolsAdded ?? []) if (!tools.includes(tool.name)) tools.push(tool.name);
  }
  return tools;
}

const nameOf = modelNames();

/**
 * The scripted steps of one faux provider, each wrapped to record the request it answers and the message it returns,
 * or the steps unchanged when the runner did not preload the recorder. The transcript names each faux provider in the
 * order of its first request.
 */
export function recordedSteps(steps: FauxResponseStep[]): FauxResponseStep[] {
  if (!recording) return steps;
  const key = {};
  return steps.map((step) => async (context, options, state, fauxModel) => {
    const model = nameOf(key);
    record({ kind: "request", model, messages: context.messages.map(messageOf), tools: toolsOf(context.messages) });
    const answer: AssistantMessage = typeof step === "function" ? await step(context, options, state, fauxModel) : step;
    const message = messageOf(answer);
    // A scripted step's ids are the script's, except those pi-ai's fauxToolCall() made up when the step gave none: its
    // randomId() writes them as "<prefix>:<Date.now()>:<random>", so they differ on every run.
    const scripted = toolCallIds(message).filter((id) => !/^[a-z]+:\d+:[a-z0-9]+$/.test(id));
    record({ kind: "response", model, message, finish: answer.stopReason, scripted });
    return answer;
  });
}

// The faux provider answers away from the example's stack, so the session call that starts a run lends it its line.
if (recording) recordCallers(AgentSession.prototype, ["prompt", "steer", "followUp", "compact"]);
