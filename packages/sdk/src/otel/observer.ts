/**
 * The OpenTelemetry observer: projects a run's events onto GenAI spans. One `invoke_agent` span covers the run, a
 * `chat` span covers each model call and an `execute_tool` span covers each tool call, both children of the run's
 * span. The observer only watches, like every observer: a tracer that throws is reported as a `hook_error` event
 * and never touches the run, and the run's own spans are still ended and forgotten.
 *
 * The observer writes to the tracer the caller passes and nowhere else. It imports nothing from OpenTelemetry, so
 * `@opentelemetry/api` is the caller's dependency, and the trace context it needs comes in as options, not from an
 * ambient context that Workers and other runtimes may not carry across `await`.
 */
import { type AssistantMessage, totalInput, type Usage } from "@buildanagent/gateway";
import type { AgentEvent } from "../events.js";
import type { Observer } from "../hooks.js";
import { GEN_AI_ATTRIBUTES as A, GEN_AI_OPERATIONS } from "./attributes.js";
import { inputMessagesJson, jsonValue, outputMessagesJson, resultParts, systemInstructionsJson } from "./content.js";

/** An attribute value a span accepts. */
export type AttributeValueLike = string | number | boolean | string[];

/** The `SpanKind` numbers of `@opentelemetry/api`. */
const SPAN_KIND_INTERNAL = 0;
const SPAN_KIND_CLIENT = 2;
/** `SpanStatusCode.ERROR` of `@opentelemetry/api`. */
const STATUS_ERROR = 2;

/** What `startSpan` takes: the fields of `@opentelemetry/api`'s `SpanOptions` that the observer sets. */
export interface SpanOptionsLike {
  /** An OpenTelemetry `SpanKind` number: 0 is internal and 2 is client. */
  readonly kind?: number;
  readonly attributes?: Readonly<Record<string, AttributeValueLike>>;
  /** Start time in milliseconds since the Unix epoch. */
  readonly startTime?: number;
}

/** The span methods the observer calls. An OpenTelemetry `Span` has all of them. */
export interface SpanLike {
  setAttribute(name: string, value: AttributeValueLike): unknown;
  /** `code` 2 is `SpanStatusCode.ERROR`. */
  setStatus?(status: { readonly code: number; readonly message?: string }): unknown;
  /** `endTime` is in milliseconds since the Unix epoch. */
  end(endTime?: number): void;
}

/** The tracer method the observer calls. An OpenTelemetry `Tracer` has it, so a real tracer fits without a wrapper. */
export interface TracerLike {
  startSpan(name: string, options?: SpanOptionsLike, context?: unknown): SpanLike;
}

/** Options for `otelObserver()`. */
export interface OtelObserverOptions {
  /** The tracer that receives the spans. The observer exports nowhere else. */
  readonly tracer: TracerLike;
  /**
   * Whether to record content: the system prompt, the messages of each call, each tool's arguments and result, and
   * the message of each error as its span's status description. Off by default, because content can hold secrets
   * and personal data that a trace backend should not receive. An error's message can quote any of them, so with
   * content off a failed span gets only its error status and `error.type`.
   */
  readonly captureContent?: boolean;
  /** The agent's name: it names the `invoke_agent` span and sets `gen_ai.agent.name`. */
  readonly agentName?: string;
  /**
   * The context the run's span starts in, passed to the tracer as `startSpan`'s third argument: the caller's own
   * span, such as an incoming request's. Every top-level run the observer serves starts in this one context, so when
   * it belongs to one request, create one observer for each request. Left out, the run's span starts in whatever the
   * tracer treats as its default, which for an OpenTelemetry tracer is the active context. A run that a tool starts
   * and that carries `parentRun` (`nestedRunDepth()` sets it) is a child of the calling tool's span, when this
   * observer saw that tool call start; any other nested run starts in `parentContext` too.
   */
  readonly parentContext?: unknown;
  /**
   * Makes the context a child span starts in from the run's span, so the spans of model and tool calls are children
   * of the run's span in its trace. With OpenTelemetry's API, pass
   * `(span) => trace.setSpan(context.active(), span as Span)`. It is required because the observer imports nothing
   * from OpenTelemetry and so cannot build a context itself.
   */
  readonly childContext: (parent: SpanLike) => unknown;
  /**
   * Flushes the exporter behind the tracer, such as `() => provider.forceFlush()`. `flush()` on the observer calls
   * it, so a Worker can pass `observer.flush()` to `waitUntil` and keep its spans from dying with the request.
   */
  readonly forceFlush?: () => Promise<unknown>;
}

/** The observer `otelObserver()` returns: an `Observer` that can also flush its exporter and end a run that threw. */
export type OtelObserver = Observer & {
  /** Resolves once the exporter behind the tracer has flushed, or at once when `forceFlush` was not passed. */
  flush(): Promise<void>;
  /**
   * Ends the open spans of a run whose `result` rejected, as failed, and forgets the run. A run that throws, for a
   * programmer error such as a tool that returns a malformed result, sends no `run_end`, so without this call its
   * spans are never exported. `error.type` is the error's `code` when it has one, such as an `SdkError`'s, and its
   * `name` otherwise. It ends every span, then rethrows the first error a tracer threw. An unknown run id, or a run
   * that already ended, does nothing.
   */
  endRun(runId: string, error?: unknown): void;
};

interface RunSpans {
  readonly agent: SpanLike;
  readonly childContext: unknown;
  model: SpanLike | undefined;
  readonly tools: Map<string, SpanLike>;
}

function millis(timestamp: string): number | undefined {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? undefined : value;
}

/** Marks a span failed. `message` is free text, so it goes in only when `withMessage`, which content capture sets. */
function failed(span: SpanLike, message: string, withMessage: boolean, errorType?: string): void {
  if (errorType !== undefined) span.setAttribute(A.errorType, errorType);
  span.setStatus?.(withMessage ? { code: STATUS_ERROR, message } : { code: STATUS_ERROR });
}

/** The low-cardinality `error.type` of a thrown value: its `code`, then its `name`, then the conventions' `_OTHER`. */
function errorTypeOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string" && code !== "") return code;
    if (typeof name === "string" && name !== "") return name;
  }
  return "_OTHER";
}

/**
 * Writes the usage attributes of one call or one run. Input counts every class, because the conventions' input
 * tokens include cached tokens (D3). A usage the provider did not report writes nothing, since its counts are
 * incomplete and zero would read as a measurement.
 */
function setUsage(span: SpanLike, usage: Usage): void {
  if (usage.unreported === true) return;
  span.setAttribute(A.usageInputTokens, totalInput(usage));
  span.setAttribute(A.usageOutputTokens, usage.output);
  if (usage.cacheRead > 0) span.setAttribute(A.usageCacheReadInputTokens, usage.cacheRead);
  const cacheWrite = usage.cacheWrite["5m"] + usage.cacheWrite["1h"];
  if (cacheWrite > 0) span.setAttribute(A.usageCacheWriteInputTokens, cacheWrite);
  if (usage.reasoning > 0) span.setAttribute(A.usageReasoningOutputTokens, usage.reasoning);
}

/** The finish reason each stop reason of a model call reports; an aborted call is `interrupted`. */
const FINISH_REASONS: Readonly<Record<AssistantMessage["stopReason"], string>> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_calls",
  error: "error",
  aborted: "interrupted",
};

/** Holds the open spans of each run and turns one event at a time into span calls. */
class Projection {
  readonly #options: OtelObserverOptions;
  readonly #tracer: TracerLike;
  readonly #captureContent: boolean;
  readonly #runs = new Map<string, RunSpans>();

  constructor(options: OtelObserverOptions) {
    this.#options = options;
    this.#tracer = options.tracer;
    this.#captureContent = options.captureContent ?? false;
  }

  handle(event: AgentEvent): void {
    if (event.type === "run_start") {
      this.#startAgent(event);
      return;
    }
    const spans = this.#runs.get(event.runId);
    if (spans === undefined) return;
    switch (event.type) {
      case "model_call_start":
        this.#startModelCall(event, spans);
        break;
      case "model_call_end":
        this.#endModelCall(event, spans);
        break;
      case "tool_call_start":
        this.#startTool(event, spans);
        break;
      case "tool_call_end":
        this.#endTool(event, spans);
        break;
      case "approval_request":
        this.#pauseTool(event, spans);
        break;
      case "run_end":
        this.#endRun(event, spans);
        break;
      default:
        break;
    }
  }

  #startAgent(event: Extract<AgentEvent, { type: "run_start" }>): void {
    const name = this.#options.agentName;
    const agent = this.#tracer.startSpan(
      name === undefined ? GEN_AI_OPERATIONS.invokeAgent : `${GEN_AI_OPERATIONS.invokeAgent} ${name}`,
      {
        kind: SPAN_KIND_INTERNAL,
        attributes: {
          [A.operationName]: GEN_AI_OPERATIONS.invokeAgent,
          [A.providerName]: event.model.provider,
          [A.requestModel]: event.model.id,
          ...(name === undefined ? {} : { [A.agentName]: name }),
        },
        ...startTime(event),
      },
      this.#parentContextOf(event),
    );
    let childContext: unknown;
    try {
      childContext = this.#options.childContext(agent);
    } catch (error) {
      // The run's span would otherwise stay open for ever, since the run is never registered to end it.
      agent.end(millis(event.timestamp));
      throw error;
    }
    this.#runs.set(event.runId, { agent, childContext, model: undefined, tools: new Map() });
  }

  /** The context a run's span starts in: the calling tool call's span for a nested run this observer can place. */
  #parentContextOf(event: Extract<AgentEvent, { type: "run_start" }>): unknown {
    const { parentRunId, parentCallId } = event;
    const caller =
      parentRunId === undefined || parentCallId === undefined
        ? undefined
        : this.#runs.get(parentRunId)?.tools.get(parentCallId);
    return caller === undefined ? this.#options.parentContext : this.#options.childContext(caller);
  }

  #startModelCall(event: Extract<AgentEvent, { type: "model_call_start" }>, spans: RunSpans): void {
    const { model, context, options } = event.request;
    const span = this.#tracer.startSpan(
      `${GEN_AI_OPERATIONS.chat} ${model.id}`,
      {
        kind: SPAN_KIND_CLIENT,
        attributes: {
          [A.operationName]: GEN_AI_OPERATIONS.chat,
          [A.providerName]: model.provider,
          [A.requestModel]: model.id,
          ...(options.maxOutputTokens === undefined ? {} : { [A.requestMaxTokens]: options.maxOutputTokens }),
          ...(options.temperature === undefined ? {} : { [A.requestTemperature]: options.temperature }),
        },
        ...startTime(event),
      },
      spans.childContext,
    );
    // Registered before any content is written, so a throw below leaves a span the run's end can still close.
    this.#replace(spans.model, event);
    spans.model = span;
    if (this.#captureContent) {
      span.setAttribute(A.systemInstructions, systemInstructionsJson(context.system));
      span.setAttribute(A.inputMessages, inputMessagesJson(context.messages));
    }
  }

  #endModelCall(event: Extract<AgentEvent, { type: "model_call_end" }>, spans: RunSpans): void {
    const span = spans.model;
    if (span === undefined) return;
    spans.model = undefined;
    const { message } = event;
    // No `gen_ai.response.model`: `message.model` is the model the request named, not the one the provider says
    // answered, so writing it would claim a measurement the gateway does not make.
    try {
      span.setAttribute(A.responseFinishReasons, [FINISH_REASONS[message.stopReason]]);
      setUsage(span, message.usage);
      if (message.error !== undefined) {
        const { kind, status } = message.error;
        failed(span, message.error.message, this.#captureContent, status === undefined ? kind : String(status));
      }
      if (this.#captureContent) span.setAttribute(A.outputMessages, outputMessagesJson(message.content));
    } finally {
      span.end(millis(event.timestamp));
    }
  }

  #startTool(event: Extract<AgentEvent, { type: "tool_call_start" }>, spans: RunSpans): void {
    const span = this.#tracer.startSpan(
      `${GEN_AI_OPERATIONS.executeTool} ${event.tool}`,
      {
        kind: SPAN_KIND_INTERNAL,
        attributes: {
          [A.operationName]: GEN_AI_OPERATIONS.executeTool,
          [A.toolName]: event.tool,
          [A.toolCallId]: event.callId,
          [A.toolType]: "function",
        },
        ...startTime(event),
      },
      spans.childContext,
    );
    this.#replace(spans.tools.get(event.callId), event);
    spans.tools.set(event.callId, span);
    if (this.#captureContent) span.setAttribute(A.toolCallArguments, jsonValue(event.input));
  }

  #endTool(event: Extract<AgentEvent, { type: "tool_call_end" }>, spans: RunSpans): void {
    const span = spans.tools.get(event.callId);
    if (span === undefined) return;
    spans.tools.delete(event.callId);
    try {
      if (event.result.isError === true) failed(span, "the tool returned an error", true, "tool_error");
      if (this.#captureContent) {
        // A `beforeToolCall` gate may have replaced the model's input; the span records what the tool ran with.
        if ("input" in event) span.setAttribute(A.toolCallArguments, jsonValue(event.input));
        span.setAttribute(A.toolCallResult, jsonValue(resultParts(event.result.content)));
      }
    } finally {
      span.end(millis(event.timestamp));
    }
  }

  /**
   * Ends the span of a call a gate paused. The call didn't fail, so the span carries no error; it records nothing of
   * the signed request, whose signature and key id belong in the host's own store, not in telemetry.
   */
  #pauseTool(event: Extract<AgentEvent, { type: "approval_request" }>, spans: RunSpans): void {
    const span = spans.tools.get(event.request.callId);
    if (span === undefined) return;
    spans.tools.delete(event.request.callId);
    span.end(millis(event.timestamp));
  }

  /** Ends a span that a new call with the same key is about to displace, so it is exported and not lost. */
  #replace(open: SpanLike | undefined, event: AgentEvent): void {
    if (open !== undefined) this.#abort(open, "a new call started before this one finished", millis(event.timestamp));
  }

  /** Marks an unfinished span failed and ends it, even when marking it throws. */
  #abort(span: SpanLike, message: string, end: number | undefined): void {
    try {
      failed(span, message, true);
    } finally {
      span.end(end);
    }
  }

  #endRun(event: Extract<AgentEvent, { type: "run_end" }>, spans: RunSpans): void {
    const { result } = event;
    this.#close(event.runId, spans, millis(event.timestamp), () => {
      setUsage(spans.agent, result.usage);
      if (result.stopReason === "error") {
        failed(spans.agent, result.error.message, this.#captureContent, result.error.kind);
      }
    });
  }

  /** Ends a run that threw, as `OtelObserver.endRun` describes. */
  abandon(runId: string, error: unknown): void {
    const spans = this.#runs.get(runId);
    if (spans === undefined) return;
    const message = error instanceof Error ? error.message : String(error);
    this.#close(runId, spans, undefined, () => {
      failed(spans.agent, message, this.#captureContent, errorTypeOf(error));
    });
  }

  /**
   * Ends a run's open call spans as failed, marks its own span with `mark`, ends it and forgets the run. The run is
   * forgotten and every span ended even when the tracer throws partway, so a failing tracer leaks nothing. The first
   * error is rethrown after all of them have been tried.
   */
  #close(runId: string, spans: RunSpans, end: number | undefined, mark: () => void): void {
    this.#runs.delete(runId);
    const open = [...(spans.model === undefined ? [] : [spans.model]), ...spans.tools.values()];
    const errors: unknown[] = [];
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const span of open) attempt(() => this.#abort(span, "the run ended before this call finished", end));
    attempt(mark);
    attempt(() => spans.agent.end(end));
    if (errors.length > 0) throw errors[0];
  }
}

/**
 * Creates an observer that projects a run's events onto OpenTelemetry GenAI spans. Pass it in `run()`'s
 * `observers`: an observer added later with `run.on()` misses `run_start`, so it records nothing for that run. One
 * observer can serve many runs, because it keeps each run's spans apart by run id.
 *
 * Without `captureContent`, no span holds a prompt, a message, a tool argument, a tool result or an error message.
 */
export function otelObserver(options: OtelObserverOptions): OtelObserver {
  const projection = new Projection(options);
  return Object.assign((event: AgentEvent) => projection.handle(event), {
    async flush(): Promise<void> {
      await options.forceFlush?.();
    },
    endRun(runId: string, error?: unknown): void {
      projection.abandon(runId, error);
    },
  });
}

function startTime(event: AgentEvent): { readonly startTime?: number } {
  const time = millis(event.timestamp);
  return time === undefined ? {} : { startTime: time };
}
