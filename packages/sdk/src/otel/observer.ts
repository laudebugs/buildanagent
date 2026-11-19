/**
 * The OpenTelemetry observer: projects a run's events onto GenAI spans. One `invoke_agent` span covers the run, a
 * `chat` span covers each model call and an `execute_tool` span covers each tool call, both children of the run's
 * span. The observer only watches, like every observer: a tracer that throws is reported as a `hook_error` event
 * and never touches the run.
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
   * Whether to record content: the system prompt, the messages of each call and each tool's arguments and result.
   * Off by default, because content can hold secrets and personal data that a trace backend should not receive.
   */
  readonly captureContent?: boolean;
  /** The agent's name: it names the `invoke_agent` span and sets `gen_ai.agent.name`. */
  readonly agentName?: string;
  /**
   * The context the run's span starts in, passed to the tracer as `startSpan`'s third argument: the caller's own
   * span, such as an incoming request's. Left out, the run's span starts a new trace in whatever the tracer treats
   * as its default.
   */
  readonly parentContext?: unknown;
  /**
   * Makes the context a child span starts in from the run's span. With OpenTelemetry's API, pass
   * `(span) => trace.setSpan(context.active(), span as Span)`. Left out, the spans of model and tool calls get no
   * parent, because the observer cannot build a context without `@opentelemetry/api`.
   */
  readonly childContext?: (parent: SpanLike) => unknown;
  /**
   * Flushes the exporter behind the tracer, such as `() => provider.forceFlush()`. `flush()` on the observer calls
   * it, so a Worker can pass `observer.flush()` to `waitUntil` and keep its spans from dying with the request.
   */
  readonly forceFlush?: () => Promise<unknown>;
}

/** The observer `otelObserver()` returns: an `Observer` that can also flush its exporter. */
export type OtelObserver = Observer & {
  /** Resolves once the exporter behind the tracer has flushed, or at once when `forceFlush` was not passed. */
  flush(): Promise<void>;
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

function failed(span: SpanLike, message: string, errorType?: string): void {
  if (errorType !== undefined) span.setAttribute(A.errorType, errorType);
  span.setStatus?.({ code: STATUS_ERROR, message });
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
      this.#options.parentContext,
    );
    const childContext = this.#options.childContext?.(agent);
    this.#runs.set(event.runId, { agent, childContext, model: undefined, tools: new Map() });
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
    if (this.#captureContent) {
      span.setAttribute(A.systemInstructions, systemInstructionsJson(context.system));
      span.setAttribute(A.inputMessages, inputMessagesJson(context.messages));
    }
    spans.model = span;
  }

  #endModelCall(event: Extract<AgentEvent, { type: "model_call_end" }>, spans: RunSpans): void {
    const span = spans.model;
    if (span === undefined) return;
    const { message } = event;
    span.setAttribute(A.responseModel, message.model.id);
    span.setAttribute(A.responseFinishReasons, [FINISH_REASONS[message.stopReason]]);
    setUsage(span, message.usage);
    if (message.error !== undefined) {
      const { kind, status } = message.error;
      failed(span, message.error.message, status === undefined ? kind : String(status));
    }
    if (this.#captureContent) span.setAttribute(A.outputMessages, outputMessagesJson(message.content));
    span.end(millis(event.timestamp));
    spans.model = undefined;
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
    if (this.#captureContent) span.setAttribute(A.toolCallArguments, jsonValue(event.input));
    spans.tools.set(event.callId, span);
  }

  #endTool(event: Extract<AgentEvent, { type: "tool_call_end" }>, spans: RunSpans): void {
    const span = spans.tools.get(event.callId);
    if (span === undefined) return;
    if (event.result.isError === true) failed(span, "the tool returned an error", "tool_error");
    if (this.#captureContent) span.setAttribute(A.toolCallResult, jsonValue(resultParts(event.result.content)));
    span.end(millis(event.timestamp));
    spans.tools.delete(event.callId);
  }

  #endRun(event: Extract<AgentEvent, { type: "run_end" }>, spans: RunSpans): void {
    const end = millis(event.timestamp);
    // A run that ends mid-call leaves spans open. Close them as failed rather than leak them.
    for (const span of [...(spans.model === undefined ? [] : [spans.model]), ...spans.tools.values()]) {
      failed(span, "the run ended before this call finished");
      span.end(end);
    }
    const { result } = event;
    setUsage(spans.agent, result.usage);
    if (result.stopReason === "error") failed(spans.agent, result.error.message, result.error.kind);
    spans.agent.end(end);
    this.#runs.delete(event.runId);
  }
}

/**
 * Creates an observer that projects a run's events onto OpenTelemetry GenAI spans. Pass it in `run()`'s
 * `observers`. One observer can serve many runs, because it keeps each run's spans apart by run id.
 *
 * Without `captureContent`, no span holds a prompt, a message, a tool argument or a tool result.
 */
export function otelObserver(options: OtelObserverOptions): OtelObserver {
  const projection = new Projection(options);
  return Object.assign((event: AgentEvent) => projection.handle(event), {
    async flush(): Promise<void> {
      await options.forceFlush?.();
    },
  });
}

function startTime(event: AgentEvent): { readonly startTime?: number } {
  const time = millis(event.timestamp);
  return time === undefined ? {} : { startTime: time };
}
