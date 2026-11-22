/**
 * Turns a session's entries into a tree of planned spans: names, times, attributes and parents, with nothing sent to a
 * tracer yet. The projection emits the plan afterwards, so every span's attributes are final before it starts, and a
 * log that ends mid-call still gives spans that end.
 */
import { addCost, addUsage, type ContentBlock, type Cost, totalInput, type Usage } from "@buildanagent/gateway";
import type { SessionEntry } from "@buildanagent/protocol";
import {
  blockPart,
  type ContentPart,
  GEN_AI_ATTRIBUTES as G,
  GEN_AI_OPERATIONS,
  jsonValue,
  resultParts,
  SEMCONV_GENAI_COMMIT,
  systemInstructionsJson,
} from "@buildanagent/sdk/otel";
import { BUILDANAGENT_ATTRIBUTES as B } from "./attributes.js";
import { type MessageJson, toolMessage } from "./content.js";

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
    ...(usage.cacheRead > 0 ? { [B.usageCacheReadTokens]: usage.cacheRead } : {}),
    ...(cacheWrite > 0 ? { [B.usageCacheWriteTokens]: cacheWrite } : {}),
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

interface Tool {
  readonly span: PlannedSpan;
  /** The id of the entry that holds the call's block or its code call, and later the result's id. */
  readonly refs: string[];
}

interface Turn {
  readonly span: PlannedSpan;
  readonly system: string;
  running: Running | undefined;
}

interface Chat {
  readonly span: PlannedSpan;
  priced: boolean;
}

/** Reads entries one at a time and keeps the spans they imply. */
export class Planner {
  readonly #options: PlanOptions;
  #root: PlannedSpan | undefined;
  #turn: Turn | undefined;
  #chat: Chat | undefined;
  #running: Running | undefined;
  #last = 0;
  #previous = 0;
  readonly #messages: MessageJson[] = [];
  readonly #open = new Map<string, { message: MessageJson; ids: string[]; start: number }>();
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
    this.#handle(entry, at);
  }

  /** The root span with every open span closed at the last entry's time, or `undefined` for an empty log. */
  finish(): PlannedSpan | undefined {
    const root = this.#root;
    if (root === undefined) return undefined;
    this.#closeTurn(this.#last);
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

  get #parent(): PlannedSpan {
    return (this.#turn?.span ?? this.#root) as PlannedSpan;
  }

  #handle(entry: SessionEntry, at: number): void {
    switch (entry.type) {
      case "turn_start":
        this.#closeTurn(this.#previous);
        this.#turn = {
          span: span("turn", INTERNAL, at, { [B.runId]: entry.runId, [B.turnMode]: entry.mode }),
          system: entry.system,
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
          this.#closeTurn(at);
        }
        break;
      default:
        break;
    }
  }

  #block(entry: Extract<SessionEntry, { type: "message_block" }>): void {
    let open = this.#open.get(entry.messageId);
    if (open === undefined) {
      // The call began once its input was complete, which is when the entry before the answer's first block was written.
      open = { message: { role: entry.role, parts: [] }, ids: [], start: this.#previous };
      this.#open.set(entry.messageId, open);
      // A user message is complete as it arrives; the model sees it before the next call.
      if (entry.role === "user") this.#messages.push(open.message);
    }
    open.message.parts.push(this.#part(entry.block));
    open.ids.push(entry.id);
  }

  /** A block as a part. Arguments have their own switch, so a message's content never carries them in without it. */
  #part(block: ContentBlock): ContentPart {
    const part = blockPart(block);
    if (block.type !== "tool_call" || this.#options.toolArguments) return part;
    const { arguments: _arguments, ...rest } = part;
    return rest;
  }

  #endMessage(entry: Extract<SessionEntry, { type: "message_end" }>, at: number): void {
    const open = this.#open.get(entry.messageId);
    this.#open.delete(entry.messageId);
    const subject = { attribute: G.requestModel, value: entry.model.id };
    const attributes: Record<string, Value> = {
      [G.operationName]: GEN_AI_OPERATIONS.chat,
      [G.providerName]: entry.model.provider,
      [G.requestModel]: entry.model.id,
      [G.responseFinishReasons]: [FINISH_REASONS[entry.stopReason]],
    };
    const chat = span(GEN_AI_OPERATIONS.chat, CLIENT, open?.start ?? this.#previous, attributes, subject);
    chat.end = at;
    if (entry.error !== undefined) {
      chat.errorType = entry.error.status === undefined ? entry.error.kind : String(entry.error.status);
    }
    const ids = [...(open?.ids ?? []), entry.id];
    this.#content(attributes, ids, () => ({
      [G.systemInstructions]: systemInstructionsJson(this.#turn?.system ?? ""),
      [G.inputMessages]: JSON.stringify(this.#messages),
      [G.outputMessages]: JSON.stringify([{ role: "assistant", parts: open?.message.parts ?? [] }]),
    }));
    this.#parent.children.push(chat);
    this.#chat = { span: chat, priced: false };
    if (open === undefined) return;
    this.#messages.push(open.message);
    for (const block of open.message.parts) {
      if (block.type === "tool_call") this.#startTool(block, at, open.ids);
    }
  }

  #startTool(part: Readonly<Record<string, unknown>>, at: number, ids: readonly string[]): void {
    const callId = String(part.id);
    const name = String(part.name);
    const attributes: Record<string, Value> = {
      [G.operationName]: GEN_AI_OPERATIONS.executeTool,
      [G.toolName]: name,
      [G.toolCallId]: callId,
      [G.toolType]: "function",
    };
    if (this.#options.toolArguments) attributes[G.toolCallArguments] = jsonValue(part.arguments);
    const tool = span(GEN_AI_OPERATIONS.executeTool, INTERNAL, at, attributes, { attribute: G.toolName, value: name });
    this.#parent.children.push(tool);
    this.#tools.set(callId, { span: tool, refs: [...ids] });
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
    this.#messages.push(toolMessage(entry.callId, entry.content));
    const tool = this.#tools.get(entry.callId);
    if (tool === undefined) return;
    this.#tools.delete(entry.callId);
    tool.span.end = at;
    if (entry.isError) tool.span.errorType = "tool_error";
    this.#content(tool.span.attributes, [...tool.refs, entry.id], () => ({
      [G.toolCallResult]: jsonValue(resultParts(entry.content)),
    }));
  }

  #usage(entry: Extract<SessionEntry, { type: "usage" }>, at: number): void {
    const attributes = {
      [B.usageSource]: entry.source,
      ...usageAttributes(entry.usage),
      ...costAttributes(entry.cost),
    };
    const chat = this.#chat;
    if (entry.source === "model_call" && chat !== undefined && !chat.priced) {
      chat.priced = true;
      Object.assign(chat.span.attributes, attributes);
    } else {
      // A summary or judge call has no message of its own; its span records the call and what it cost.
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

  #closeTurn(end: number): void {
    const turn = this.#turn;
    if (turn === undefined) return;
    this.#turn = undefined;
    turn.span.end = end;
    if (turn.running !== undefined) {
      Object.assign(turn.span.attributes, usageAttributes(turn.running.usage), costAttributes(turn.running.cost));
    }
  }

  /** Writes what the level allows: the content itself, the ids of its entries, or nothing. */
  #content(attributes: Record<string, Value>, ids: string[], text: () => Record<string, Value>): void {
    if (this.#options.content === "attributes") Object.assign(attributes, text());
    else if (this.#options.content === "refs") attributes[B.contentRef] = ids;
  }
}

/** The finish reason each stop reason of a model call reports; an aborted call is `interrupted`. */
const FINISH_REASONS = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_calls",
  error: "error",
  aborted: "interrupted",
} as const;
