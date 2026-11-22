/**
 * Turns a session's entries into a tree of planned spans: names, times, attributes and parents, with nothing sent to a
 * tracer yet. The projection emits the plan afterwards, so every span's attributes are final before it starts, and a
 * log that ends mid-call still gives spans that end.
 *
 * What a model call was sent comes from `contextWithStarts()`, the function a resume rebuilds its context with, applied
 * to the entries before the call. A span's input therefore holds what the model saw: the latest compaction's summary
 * and the messages after it, and no result of a code call, which the model never reads.
 */
import {
  addCost,
  addUsage,
  type ContentBlock,
  type Cost,
  type Message,
  totalInput,
  type Usage,
} from "@buildanagent/gateway";
import type { SessionEntry } from "@buildanagent/protocol";
import {
  GEN_AI_ATTRIBUTES as G,
  GEN_AI_OPERATIONS,
  inputMessagesJson,
  jsonValue,
  outputMessagesJson,
  resultParts,
  SEMCONV_GENAI_COMMIT,
  systemInstructionsJson,
} from "@buildanagent/sdk/otel";
import { contextWithStarts } from "../session/rebuild.js";
import { BUILDANAGENT_ATTRIBUTES as B } from "./attributes.js";

/** An attribute value a span takes. */
export type Value = string | number | boolean | string[];

/** The `SpanKind` numbers of OpenTelemetry's API. */
const INTERNAL = 0;
const CLIENT = 2;

/** One span the projection will send. */
export interface PlannedSpan {
  /** The span's operation, which is its name when it has no subject or the subject is hashed. */
  readonly operation: string;
  /** What follows the operation in the span's name, with the attribute that holds the same value. */
  readonly subject?: { readonly attribute: string; readonly value: string };
  readonly kind: number;
  readonly start: number;
  end: number;
  readonly attributes: Record<string, Value>;
  /** The `error.type` of a span that failed; its presence also sets the error status. */
  errorType?: string;
  readonly children: PlannedSpan[];
}

/** The content a plan carries: nothing, the text itself, or the ids of the entries that hold it. */
export type ContentLevel = "none" | "attributes" | "refs";

/** What the plan keeps from the log. */
export interface PlanOptions {
  readonly content: ContentLevel;
  readonly toolArguments: boolean;
}

interface Running {
  usage: Usage;
  cost: Cost;
}

function span(
  operation: string,
  kind: number,
  start: number,
  attributes: Record<string, Value>,
  subject?: PlannedSpan["subject"],
): PlannedSpan {
  return {
    operation,
    ...(subject === undefined ? {} : { subject }),
    kind,
    start,
    end: start,
    attributes,
    children: [],
  };
}

function usageAttributes(usage: Usage): Record<string, Value> {
  // A usage the provider did not report is incomplete, and a zero would read as a measurement.
  if (usage.unreported === true) return {};
  const cacheWrite = usage.cacheWrite["5m"] + usage.cacheWrite["1h"];
  return {
    [G.usageInputTokens]: totalInput(usage),
    [G.usageOutputTokens]: usage.output,
    ...(usage.cacheRead > 0 ? { [G.usageCacheReadInputTokens]: usage.cacheRead } : {}),
    ...(cacheWrite > 0 ? { [G.usageCacheWriteInputTokens]: cacheWrite } : {}),
    ...(usage.reasoning > 0 ? { [G.usageReasoningOutputTokens]: usage.reasoning } : {}),
  };
}

function costAttributes(cost: Cost): Record<string, Value> {
  return { [B.costBasis]: cost.basis, ...(cost.total === null ? {} : { [B.costUsd]: cost.total }) };
}

const fold = (running: Running | undefined, usage: Usage, cost: Cost): Running =>
  running === undefined
    ? { usage, cost }
    : { usage: addUsage(running.usage, usage), cost: addCost(running.cost, cost) };

/** The finish reason each stop reason of a model call reports; an aborted call is `interrupted`. */
const FINISH_REASONS = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_calls",
  error: "error",
  aborted: "interrupted",
} as const;

interface Tool {
  readonly span: PlannedSpan;
  /** The ids of the entries that hold the call, and later its result. */
  readonly refs: string[];
}

interface Turn {
  readonly span: PlannedSpan;
  running: Running | undefined;
}

/** An assistant message whose blocks have arrived and whose `message_end` has not. */
interface OpenMessage {
  readonly blocks: ContentBlock[];
  readonly ids: string[];
  /** When the entry before the message's first block was written: the call began once its input was complete. */
  readonly start: number;
  /** The position of the message's first block, so the call's input is the entries before it. */
  readonly index: number;
}

/** Reads entries one at a time and keeps the spans they imply. */
export class Planner {
  readonly #options: PlanOptions;
  readonly #entries: SessionEntry[] = [];
  #root: PlannedSpan | undefined;
  #turn: Turn | undefined;
  /** The model-call span a `usage` entry written right now belongs to: the one the previous entry closed. */
  #chat: PlannedSpan | undefined;
  #running: Running | undefined;
  #last = 0;
  #previous = 0;
  readonly #open = new Map<string, OpenMessage>();
  readonly #tools = new Map<string, Tool>();
  readonly #approvals = new Map<string, PlannedSpan>();

  constructor(options: PlanOptions) {
    this.#options = options;
  }

  add(entry: SessionEntry): void {
    const time = Date.parse(entry.timestamp);
    // A validated log never has a bad timestamp; keeping the last good one keeps every span's end after its start.
    const at = Number.isNaN(time) ? this.#last : time;
    this.#previous = this.#last === 0 ? at : this.#last;
    this.#last = at;
    this.#root ??= span(GEN_AI_OPERATIONS.invokeAgent, INTERNAL, at, {
      [G.operationName]: GEN_AI_OPERATIONS.invokeAgent,
      [B.semconvGenaiCommit]: SEMCONV_GENAI_COMMIT,
    });
    // Only an entry written right after its message's end can hold that call's usage; any other usage entry is a
    // call whose message was superseded, as a resume reads it.
    if (entry.type !== "usage") this.#chat = undefined;
    this.#entries.push(entry);
    this.#handle(entry, at);
  }

  /** The root span with every open span closed at the last entry's time, or `undefined` for an empty log. */
  finish(): PlannedSpan | undefined {
    const root = this.#root;
    if (root === undefined) return undefined;
    // The open calls attach to the open turn, so they go in before it closes.
    for (const open of this.#open.values()) this.#unfinishedCall(open);
    this.#closeTurn(this.#last, false);
    for (const tool of this.#tools.values()) this.#unfinished(tool.span);
    for (const approval of this.#approvals.values()) this.#unfinished(approval);
    root.end = this.#last;
    if (this.#running !== undefined) {
      Object.assign(root.attributes, usageAttributes(this.#running.usage), costAttributes(this.#running.cost));
    }
    return root;
  }

  #unfinished(open: PlannedSpan): void {
    open.end = this.#last;
    open.attributes[B.unfinished] = true;
  }

  /** A model call that streamed blocks and never ended: its span closes at the log's end. Its tools never started. */
  #unfinishedCall(open: OpenMessage): void {
    const chat = span(GEN_AI_OPERATIONS.chat, CLIENT, open.start, { [G.operationName]: GEN_AI_OPERATIONS.chat });
    this.#unfinished(chat);
    this.#parent.children.push(chat);
  }

  get #parent(): PlannedSpan {
    return (this.#turn?.span ?? this.#root) as PlannedSpan;
  }

  #handle(entry: SessionEntry, at: number): void {
    switch (entry.type) {
      case "turn_start":
        this.#closeTurn(this.#previous, false);
        this.#turn = {
          span: span("turn", INTERNAL, at, { [B.runId]: entry.runId, [B.turnMode]: entry.mode }),
          running: undefined,
        };
        (this.#root as PlannedSpan).children.push(this.#turn.span);
        break;
      case "message_block":
        this.#block(entry);
        break;
      case "message_end":
        this.#endMessage(entry, at);
        break;
      case "tool_result":
        this.#result(entry, at);
        break;
      case "code_call":
        this.#codeCall(entry, at);
        break;
      case "usage":
        this.#usage(entry, at);
        break;
      case "approval_requested":
        this.#request(entry, at);
        break;
      case "approval_resolved":
        this.#resolve(entry, at);
        break;
      case "turn_end":
        if (this.#turn !== undefined) {
          Object.assign(this.#turn.span.attributes, {
            [B.turnStopReason]: entry.stopReason,
            [B.turnSteps]: entry.steps,
          });
          this.#closeTurn(at, true);
        }
        break;
      default:
        break;
    }
  }

  #block(entry: Extract<SessionEntry, { type: "message_block" }>): void {
    // A user message is complete as it arrives, and its content reaches a span only through a later call's input.
    if (entry.role !== "assistant") return;
    let open = this.#open.get(entry.messageId);
    if (open === undefined) {
      open = { blocks: [], ids: [], start: this.#previous, index: this.#entries.length - 1 };
      this.#open.set(entry.messageId, open);
    }
    open.blocks.push(entry.block);
    open.ids.push(entry.id);
  }

  /** The blocks as the span shows them: a tool call keeps its arguments only when `toolArguments` is on. */
  #shown(blocks: readonly ContentBlock[]): ContentBlock[] {
    if (this.#options.toolArguments) return [...blocks];
    return blocks.map((block) => (block.type === "tool_call" ? { ...block, input: undefined } : block));
  }

  #endMessage(entry: Extract<SessionEntry, { type: "message_end" }>, at: number): void {
    const open = this.#open.get(entry.messageId);
    this.#open.delete(entry.messageId);
    const attributes: Record<string, Value> = {
      [G.operationName]: GEN_AI_OPERATIONS.chat,
      [G.providerName]: entry.model.provider,
      [G.requestModel]: entry.model.id,
      [G.responseFinishReasons]: [FINISH_REASONS[entry.stopReason]],
    };
    const chat = span(GEN_AI_OPERATIONS.chat, CLIENT, open?.start ?? this.#previous, attributes, {
      attribute: G.requestModel,
      value: entry.model.id,
    });
    chat.end = at;
    if (entry.error !== undefined) {
      chat.errorType = entry.error.status === undefined ? entry.error.kind : String(entry.error.status);
    }
    this.#callContent(attributes, entry, open);
    this.#parent.children.push(chat);
    this.#chat = chat;
    if (open === undefined) return;
    for (const block of open.blocks) {
      if (block.type === "tool_call") this.#startTool(block, at, open.ids);
    }
  }

  /** The call's content: what it was sent and what it answered, or the ids of the entries that hold them. */
  #callContent(
    attributes: Record<string, Value>,
    end: Extract<SessionEntry, { type: "message_end" }>,
    open: OpenMessage | undefined,
  ): void {
    if (this.#options.content === "none") return;
    const before = this.#entries.slice(0, open?.index ?? this.#entries.length - 1);
    const { context, starts } = contextWithStarts(before);
    if (this.#options.content === "attributes") {
      const messages: readonly Message[] = this.#options.toolArguments
        ? context.messages
        : context.messages.map(this.#redact);
      attributes[G.systemInstructions] = systemInstructionsJson(context.system);
      attributes[G.inputMessages] = inputMessagesJson(messages);
      attributes[G.outputMessages] = outputMessagesJson(this.#shown(open?.blocks ?? []));
      return;
    }
    const system = before.findLast((entry) => entry.type === "turn_start");
    const compaction = before.findLast((entry) => entry.type === "compaction");
    attributes[B.contentRef] = [
      ...(system === undefined ? [] : [system.id]),
      ...(compaction === undefined ? [] : [compaction.id]),
      ...starts.filter((id): id is string => id !== null),
      ...(open?.ids ?? []),
      end.id,
    ];
  }

  /** A message without the arguments of the tool calls it holds. */
  readonly #redact = (message: Message): Message =>
    message.role === "assistant" ? { ...message, content: this.#shown(message.content) } : message;

  #startTool(block: Extract<ContentBlock, { type: "tool_call" }>, at: number, ids: readonly string[]): void {
    const attributes: Record<string, Value> = {
      [G.operationName]: GEN_AI_OPERATIONS.executeTool,
      [G.toolName]: block.name,
      [G.toolCallId]: block.callId,
      [G.toolType]: "function",
    };
    if (this.#options.toolArguments) attributes[G.toolCallArguments] = jsonValue(block.input);
    const tool = span(GEN_AI_OPERATIONS.executeTool, INTERNAL, at, attributes, {
      attribute: G.toolName,
      value: block.name,
    });
    this.#parent.children.push(tool);
    this.#tools.set(block.callId, { span: tool, refs: [...ids] });
  }

  #codeCall(entry: Extract<SessionEntry, { type: "code_call" }>, at: number): void {
    const attributes: Record<string, Value> = {
      [G.operationName]: GEN_AI_OPERATIONS.executeTool,
      [G.toolName]: entry.tool,
      [G.toolCallId]: entry.callId,
      [G.toolType]: "function",
      [B.toolCodeCall]: true,
    };
    if (this.#options.toolArguments) attributes[G.toolCallArguments] = jsonValue(entry.input);
    const tool = span(GEN_AI_OPERATIONS.executeTool, INTERNAL, at, attributes, {
      attribute: G.toolName,
      value: entry.tool,
    });
    this.#parent.children.push(tool);
    this.#tools.set(entry.callId, { span: tool, refs: [entry.id] });
  }

  #result(entry: Extract<SessionEntry, { type: "tool_result" }>, at: number): void {
    const tool = this.#tools.get(entry.callId);
    if (tool === undefined) return;
    this.#tools.delete(entry.callId);
    tool.span.end = at;
    if (entry.isError) tool.span.errorType = "tool_error";
    if (this.#options.content === "attributes") {
      tool.span.attributes[G.toolCallResult] = jsonValue(resultParts(entry.content));
    } else if (this.#options.content === "refs") {
      tool.span.attributes[B.contentRef] = [...tool.refs, entry.id];
    }
  }

  #usage(entry: Extract<SessionEntry, { type: "usage" }>, at: number): void {
    const attributes = {
      [B.usageSource]: entry.source,
      ...usageAttributes(entry.usage),
      ...costAttributes(entry.cost),
    };
    const chat = this.#chat;
    if (entry.source === "model_call" && chat !== undefined) {
      this.#chat = undefined;
      Object.assign(chat.attributes, attributes);
    } else {
      // A summary or judge call has no message of its own, and a call whose message was superseded has none either;
      // its span records the call and what it cost.
      const other = span(GEN_AI_OPERATIONS.chat, CLIENT, this.#previous, {
        [G.operationName]: GEN_AI_OPERATIONS.chat,
        ...attributes,
      });
      other.end = at;
      this.#parent.children.push(other);
    }
    this.#running = fold(this.#running, entry.usage, entry.cost);
    if (this.#turn !== undefined) this.#turn.running = fold(this.#turn.running, entry.usage, entry.cost);
  }

  #request(entry: Extract<SessionEntry, { type: "approval_requested" }>, at: number): void {
    const wait = span("approval_wait", INTERNAL, at, { [B.approvalRequestId]: entry.request.id });
    const tool = this.#tools.get(entry.request.callId);
    (tool?.span ?? this.#parent).children.push(wait);
    this.#approvals.set(entry.request.id, wait);
  }

  #resolve(entry: Extract<SessionEntry, { type: "approval_resolved" }>, at: number): void {
    const { resolution } = entry;
    // A quorum that still waits has not answered the request, so its span stays open until an answer settles it.
    if (entry.quorum === "pending") return;
    const wait = this.#approvals.get(resolution.requestId);
    if (wait === undefined) return;
    this.#approvals.delete(resolution.requestId);
    wait.end = at;
    wait.attributes[B.approvalDecision] = "decision" in resolution ? resolution.decision : "answer";
  }

  /** Ends the open turn at `end`. A turn that no `turn_end` closed, as after a crash, is marked unfinished. */
  #closeTurn(end: number, finished: boolean): void {
    const turn = this.#turn;
    if (turn === undefined) return;
    this.#turn = undefined;
    turn.span.end = end;
    if (!finished) turn.span.attributes[B.unfinished] = true;
    if (turn.running !== undefined) {
      Object.assign(turn.span.attributes, usageAttributes(turn.running.usage), costAttributes(turn.running.cost));
    }
  }
}
