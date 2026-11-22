// Our SDK's side of the transcript recorder (scripts/transcripts/). When scripts/transcripts/book-examples.ts preloads
// the recorder, this file attaches it to `ScriptedModel`, so each request and answer of every scripted model joins the
// example's transcript; otherwise it does nothing. A live run (live.mjs) records the real adapter the same way, through
// recordedLiveAdapter(). The recorder only reads the request and the stream's events, so the model answers as it would
// without it.
import type {
  AssistantMessage,
  ContentBlock,
  Message as GatewayMessage,
  Model,
  ModelAdapter,
  ModelContext,
  ModelEvent,
} from "@buildanagent/gateway";
import { type AssistantScript, ScriptedModel, type ScriptStep, type StreamScript } from "@buildanagent/sdk/testing";
import {
  answerFacts,
  enterCaller,
  type Message,
  modelNames,
  type Part,
  record,
  recording,
  reportedUsage,
  toolCallIds,
  type Usage,
} from "../../../../scripts/transcripts/events.js";

function blockPart(block: ContentBlock): Part {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool_call":
      return { type: "tool-call", id: block.callId, name: block.name, input: block.input };
    case "image":
      return { type: "other", kind: "image", value: { mediaType: block.mediaType, bytes: block.data.length } };
  }
}

/** A tool result's output: the text the model reads, or its blocks when there is more than one text. */
function outputOf(content: readonly ContentBlock[]): unknown {
  const [only] = content;
  return content.length === 1 && only?.type === "text" ? only.text : content.map(blockPart);
}

/** The gateway's context as transcript messages: the system prompt first, then each message in order. */
function messagesOf(context: ModelContext): Message[] {
  // A tool message names only its call, so its tool's name comes from the assistant message that made the call.
  const names = new Map<string, string>();
  const messages: Message[] = context.system
    ? [{ role: "system", parts: [{ type: "text", text: context.system }] }]
    : [];
  for (const message of context.messages as readonly GatewayMessage[]) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        parts: [
          {
            type: "tool-result",
            id: message.callId,
            name: names.get(message.callId) ?? "",
            output: outputOf(message.content),
            ...(message.isError ? { error: true as const } : {}),
          },
        ],
      });
      continue;
    }
    for (const block of message.content) if (block.type === "tool_call") names.set(block.callId, block.name);
    messages.push({ role: message.role, parts: message.content.map(blockPart) });
  }
  return messages;
}

/** The model id the examples' scripted() helper gives every model, which names no real model. */
export const SCRIPTED_MODEL_ID = "scripted-model";

/** The transcript's usage classes, which a script's `usage` names the same way. */
const CLASSES = ["uncachedInput", "cacheRead", "cacheWrite", "output", "reasoning"] as const;

/**
 * The script each call of a model played, by call number, for a model whose steps went through `recordedSteps()`. A
 * function step's script is known only once it runs, so its slot fills then.
 */
const scripts = new WeakMap<object, (AssistantScript | StreamScript | undefined)[]>();

/**
 * Steps that tell the recorder which script answered each call, and `belongsTo`, which ties them to the model built
 * from them. ScriptedModel fills every count a script's `usage` leaves out with a zero, so only the script shows which
 * classes it set. A function step is wrapped so its result is kept; a fixed step is read as it is. Without the
 * recorder, the steps come back unchanged.
 */
export function recordedSteps(steps: ScriptStep[]): { steps: ScriptStep[]; belongsTo(adapter: object): void } {
  if (!recording) return { steps, belongsTo: () => {} };
  const slots = steps.map((step) => (typeof step === "function" ? undefined : step));
  const wrapped = steps.map((step, index): ScriptStep => {
    if (typeof step !== "function") return step;
    return async (request) => {
      const script = await step(request);
      slots[index] = script;
      return script;
    };
  });
  return { steps: wrapped, belongsTo: (adapter) => scripts.set(adapter, slots) };
}

/**
 * The usage of the answer to one call, holding only the classes that call's script set: none when its `usage` was
 * left out (ScriptedModel then marks the usage unreported) or empty, such as autoResponder()'s `usage: {}`. A played
 * stream's usage is the script's whole. A model whose steps the recorder never saw records none. The gateway splits
 * cache writes by lifetime; the transcript adds the two.
 */
function usageOf(message: AssistantMessage, script: AssistantScript | StreamScript | undefined): Usage | undefined {
  const { usage } = message;
  if (usage.unreported || script === undefined) return undefined;
  const set = new Set<string>("events" in script ? CLASSES : Object.keys(script.usage ?? {}));
  const counts = {
    uncachedInput: usage.uncachedInput,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite["5m"] + usage.cacheWrite["1h"],
    output: usage.output,
    reasoning: usage.reasoning,
  };
  return reportedUsage(Object.fromEntries(CLASSES.filter((key) => set.has(key)).map((key) => [key, counts[key]])));
}

const nameOf = modelNames();

/** How one adapter's answers are recorded: their usage, their model id, and whose tool-call ids they hold. */
interface AnswerRecord {
  usage(message: AssistantMessage): Usage | undefined;
  /** The model id to record, or undefined for none. */
  modelId(message: AssistantMessage): string | undefined;
  /** True when a script chose the answer's tool-call ids, so the writer keeps them as written. */
  scriptedIds: boolean;
}

/** Records each answer once its stream ends, from the terminal event's message. */
async function* recorded(
  owner: object,
  events: AsyncIterable<ModelEvent>,
  answer: AnswerRecord,
): AsyncGenerator<ModelEvent> {
  for await (const event of events) {
    if (event.type === "done" || event.type === "error") {
      const message: Message = { role: "assistant", parts: event.message.content.map(blockPart) };
      record({
        kind: "response",
        model: nameOf(owner),
        message,
        finish: event.message.stopReason,
        ...answerFacts(answer.usage(event.message), answer.modelId(event.message)),
        ...(answer.scriptedIds ? { scripted: toolCallIds(message) } : {}),
      });
    }
    yield event;
  }
}

/** Records one call's request, before its answer streams. */
function recordRequest(owner: object, context: ModelContext): void {
  record({
    kind: "request",
    model: nameOf(owner),
    messages: messagesOf(context),
    tools: context.tools.map((tool) => tool.name),
  });
}

/** Wraps `ScriptedModel.prototype.stream` so that each call records its request, then its answer. */
function attach(): void {
  const proto = ScriptedModel.prototype;
  const stream = proto.stream;
  proto.stream = function (this: ScriptedModel, ref, context, options) {
    recordRequest(this, context);
    // The call's number among this model's calls picks its script: `calls` holds every earlier request. A function
    // step's script fills its slot only once it runs, so the slot is read when the answer ends.
    const call = this.calls.length;
    // The scripted model answers with exactly what its script holds, ids and usage included.
    return recorded(this, stream.call(this, ref, context, options), {
      usage: (message) => usageOf(message, scripts.get(this)?.[call]),
      modelId: ({ model }) => (model.id === SCRIPTED_MODEL_ID ? undefined : model.id),
      scriptedIds: true,
    });
  };
}

if (recording) attach();

/** The usage a real provider reported, in every class, or none when it reported none. */
function liveUsage({ usage }: AssistantMessage): Usage | undefined {
  if (usage.unreported) return undefined;
  return reportedUsage({
    uncachedInput: usage.uncachedInput,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite["5m"] + usage.cacheWrite["1h"],
    output: usage.output,
    reasoning: usage.reasoning,
  });
}

/**
 * The live run's adapter (live.mjs), recording each call as a scripted one is recorded: the request, then the answer
 * with the usage the provider reported. A real model chose every tool-call id, so the writer keeps none as written.
 * Without the recorder the adapter comes back unchanged.
 */
export function recordedLiveAdapter(adapter: ModelAdapter): ModelAdapter {
  if (!recording) return adapter;
  const owner = {};
  return {
    ...adapter,
    stream: (ref, context, options) => {
      recordRequest(owner, context);
      return recorded(owner, adapter.stream(ref, context, options), {
        usage: liveUsage,
        modelId: () => undefined,
        scriptedIds: false,
      });
    },
  };
}

/**
 * The model as a run receives it, lending each run the example line that started it. `run()` is a plain function
 * that starts the loop after it returns, so the recorder cannot wrap it as it wraps a method; it does read
 * `model.ref` while the example's call is still on the stack, and that read marks the line. Without the recorder the
 * model is returned unchanged.
 */
export function lendCallerLine(model: Model): Model {
  if (!recording) return model;
  const { ref } = model;
  return Object.defineProperty({ ...model }, "ref", {
    enumerable: true,
    get() {
      enterCaller();
      return ref;
    },
  });
}
