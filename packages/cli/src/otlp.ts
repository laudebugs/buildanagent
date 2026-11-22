/**
 * A tracer that sends its spans to one OTLP/HTTP endpoint as JSON, for `--otlp-endpoint`. It is the CLI's only
 * exporter, so nothing leaves the machine unless that flag names where to. It implements the SDK's `TracerLike`, so
 * the SDK's OpenTelemetry observer writes to it without the OpenTelemetry packages, and it holds every span until
 * `flush()`, which a command calls once before it exits.
 */

import { SEMCONV_GENAI_COMMIT, type SpanLike, type SpanOptionsLike, type TracerLike } from "@buildanagent/sdk/otel";
import { CliError } from "./errors.js";

type Value = string | number | boolean | string[];

interface Recorded {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly start: number;
  end?: number;
  readonly attributes: Map<string, Value>;
  status?: { code: number; message?: string };
}

/** What `otlpTracer()` takes. */
export interface OtlpTracerOptions {
  /** The collector's base URL, such as `http://localhost:4318`, or its full `/v1/traces` URL. */
  readonly endpoint: string;
  /** The `fetch` that sends the spans. Default the global one. */
  readonly fetch?: typeof globalThis.fetch;
  /** The clock for a span that names no start or end time, in milliseconds. Default `Date.now`. */
  readonly now?: () => number;
}

/** A `TracerLike` that also sends what it holds. */
export interface OtlpTracer extends TracerLike {
  /** The context a child span starts in, for the observer's `childContext`. */
  childContext(parent: SpanLike): unknown;
  /**
   * Sends every ended span in one request and forgets them. Rejects with a `CliError` when the collector can't be
   * reached or answers with an error.
   */
  flush(): Promise<void>;
}

const hex = (bytes: number): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

// The API's SpanKind counts from 0 and OTLP's from 1, where 0 means unspecified.
const otlpKind = (kind: number | undefined): number => (kind ?? 0) + 1;

const nanos = (millis: number): string => (BigInt(Math.round(millis)) * 1_000_000n).toString();

function anyValue(value: Value): Record<string, unknown> {
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => ({ stringValue: item })) } };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

const attributesOf = (attributes: ReadonlyMap<string, Value>) =>
  [...attributes].map(([key, value]) => ({ key, value: anyValue(value) }));

function wireSpan(span: Recorded) {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: nanos(span.start),
    endTimeUnixNano: nanos(span.end ?? span.start),
    attributes: attributesOf(span.attributes),
    ...(span.status === undefined ? {} : { status: span.status }),
  };
}

const tracesUrl = (endpoint: string): string =>
  endpoint.endsWith("/v1/traces") ? endpoint : `${endpoint.replace(/\/+$/, "")}/v1/traces`;

/** A tracer that sends the spans it records to `options.endpoint` when flushed. */
export function otlpTracer(options: OtlpTracerOptions): OtlpTracer {
  const now = options.now ?? Date.now;
  const ended: Recorded[] = [];
  const records = new WeakMap<SpanLike, Recorded>();
  const resource = new Map<string, Value>([
    ["service.name", "buildanagent"],
    ["buildanagent.semconv_genai.commit", SEMCONV_GENAI_COMMIT],
  ]);
  const startSpan = (name: string, spanOptions: SpanOptionsLike = {}, context?: unknown): SpanLike => {
    const parent = context instanceof Object ? records.get(context as SpanLike) : undefined;
    const record: Recorded = {
      traceId: parent?.traceId ?? hex(16),
      spanId: hex(8),
      ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
      name,
      kind: otlpKind(spanOptions.kind),
      start: spanOptions.startTime ?? now(),
      attributes: new Map(Object.entries(spanOptions.attributes ?? {})),
    };
    const span: SpanLike = {
      setAttribute: (key, value) => record.attributes.set(key, value),
      setStatus: (status) => {
        record.status = { code: status.code, ...(status.message === undefined ? {} : { message: status.message }) };
      },
      end: (endTime) => {
        // OpenTelemetry ignores a second end(), so a span ended twice is still one span on the collector.
        if (record.end !== undefined) return;
        record.end = endTime ?? now();
        ended.push(record);
      },
    };
    records.set(span, record);
    return span;
  };
  return {
    startSpan,
    childContext: (parent) => parent,
    async flush() {
      if (ended.length === 0) return;
      const spans = ended.splice(0).map(wireSpan);
      const body = {
        resourceSpans: [
          {
            resource: { attributes: attributesOf(resource) },
            scopeSpans: [{ scope: { name: "buildanagent" }, spans }],
          },
        ],
      };
      const send = options.fetch ?? globalThis.fetch;
      const url = tracesUrl(options.endpoint);
      let response: Response;
      try {
        response = await send(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (error) {
        // A refused connection or an unknown host is the caller's to fix, like an error status, so it exits 2 too.
        const why = error instanceof Error ? error.message : String(error);
        throw new CliError("otlp_failed", `could not send the spans to the OTLP endpoint ${url}: ${why}`, {
          cause: error,
        });
      }
      if (!response.ok) throw new CliError("otlp_failed", `the OTLP endpoint answered ${response.status}`);
    },
  };
}
