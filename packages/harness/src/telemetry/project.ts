/**
 * `projectSpans()`: rebuilds a session's OpenTelemetry spans from its log. Telemetry is a projection of the log, not a
 * second record, so the same entries give the same spans on any day, in any process, and a change to what is exported
 * never needs a change to what is stored.
 */
import type { SessionEntry } from "@buildanagent/protocol";
import { GEN_AI_ATTRIBUTES as G, type SpanLike, type TracerLike } from "@buildanagent/sdk/otel";
import { HarnessError } from "../errors.js";
import { type ContentLevel, type PlannedSpan, Planner, type Value } from "./plan.js";

/** `SpanStatusCode.ERROR` of `@opentelemetry/api`. */
const STATUS_ERROR = 2;

const LEVELS: readonly ContentLevel[] = ["none", "attributes", "refs"];

/** Options for `projectSpans()`. */
export interface ProjectSpansOptions {
  /** The tracer that receives the spans. The projection exports nowhere else. */
  readonly tracer: TracerLike;
  /**
   * Makes the context a child span starts in from its parent's span, so the tree is one trace. With OpenTelemetry's
   * API, pass `(span) => trace.setSpan(context.active(), span as Span)`. It is required because the harness imports
   * nothing from OpenTelemetry and so cannot build a context itself.
   */
  readonly childContext: (parent: SpanLike) => unknown;
  /** The context the root span starts in, passed to the tracer as `startSpan`'s third argument. */
  readonly parentContext?: unknown;
  /**
   * What the spans carry of the conversation. `none`, the default, writes no message, prompt or tool result.
   * `attributes` writes them as the conventions' content attributes. `refs` writes the ids of the log entries that hold
   * them, for a backend that can fetch them from the session store and should not hold the text.
   */
  readonly content?: ContentLevel;
  /**
   * Whether `execute_tool` spans carry the arguments of the call, and whether the messages at level `attributes` show
   * them. Off by default and independent of `content`, because arguments hold what a user asked for: a path, a query,
   * a customer id.
   */
  readonly toolArguments?: boolean;
  /**
   * Replaces the value of each named attribute with its HMAC-SHA-256 under `key`, as lower-case hex, before the span
   * is exported, so two spans with the same value still match while the value never leaves the process. A string is
   * hashed as it is, a number or boolean as its text and a list as its JSON. A span's name leaves out a hashed
   * tool name or request model attribute, which it would otherwise repeat.
   */
  readonly hashAttributes?: { readonly key: Uint8Array; readonly names: readonly string[] };
}

function invalid(message: string): HarnessError {
  return new HarnessError("invalid_telemetry_options", message);
}

function check(options: ProjectSpansOptions): void {
  if (options.content !== undefined && !LEVELS.includes(options.content)) {
    throw invalid(`content must be one of ${LEVELS.join(", ")}, not ${JSON.stringify(options.content)}`);
  }
  const hash = options.hashAttributes;
  if (hash === undefined) return;
  if (hash.key.byteLength === 0) throw invalid("hashAttributes.key must not be empty");
  if (hash.names.some((name) => typeof name !== "string" || name === "")) {
    throw invalid("hashAttributes.names must be non-empty strings");
  }
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The text a value is hashed as. */
const textOf = (value: Value): string => (typeof value === "string" ? value : JSON.stringify(value));

/** Replaces the values of the named attributes with their keyed hashes. */
type Hasher = (attributes: Record<string, Value>) => Promise<Record<string, Value>>;

async function hasher(options: ProjectSpansOptions): Promise<{ hash: Hasher; hidden: (name: string) => boolean }> {
  const config = options.hashAttributes;
  if (config === undefined || config.names.length === 0)
    return { hash: async (attributes) => attributes, hidden: () => false };
  const names = new Set(config.names);
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(config.key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sign = async (value: Value): Promise<string> =>
    hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(textOf(value))));
  return {
    hidden: (name) => names.has(name),
    async hash(attributes) {
      const out: Record<string, Value> = {};
      for (const [name, value] of Object.entries(attributes)) out[name] = names.has(name) ? await sign(value) : value;
      return out;
    },
  };
}

/**
 * Projects a session's entries onto spans: `invoke_agent` for the session, a `turn` for each run or resume, a `chat`
 * span for each model call and an `execute_tool` span for each tool call, with an `approval_wait` span under a call
 * that waited for a person, from its `approval_requested` entry to its `approval_resolved` entry. A tool call's span is
 * a sibling of the model call that asked for it, as in the SDK's live observer, and it ends at the call's result, so a
 * call that waited ends in the turn that resumed it.
 *
 * Pass the entries of one branch in log order, such as `session.path()` or a store's `load()`. The spans carry the
 * entries' own timestamps, so their durations are what the log recorded. A span with no closing entry ends at the log's
 * last timestamp and carries `buildanagent.span.unfinished`. Token counts, prices and the conventions' commit are
 * written as the attributes the package README lists; a session whose price is
 * unknown carries `buildanagent.cost.basis` of `unknown` and no `buildanagent.cost.usd`.
 *
 * Resolves when every span has ended. Throws a `HarnessError` with code `invalid_telemetry_options` for a setting it
 * cannot use, and rejects with the tracer's error when the tracer throws.
 */
export async function projectSpans(
  entries: AsyncIterable<SessionEntry> | Iterable<SessionEntry>,
  options: ProjectSpansOptions,
): Promise<void> {
  check(options);
  const planner = new Planner({ content: options.content ?? "none", toolArguments: options.toolArguments ?? false });
  for await (const entry of entries) planner.add(entry);
  const root = planner.finish();
  if (root === undefined) return;
  const { hash, hidden } = await hasher(options);

  async function emit(plan: PlannedSpan, context: unknown): Promise<void> {
    const attributes = {
      ...plan.attributes,
      ...(plan.errorType === undefined ? {} : { [G.errorType]: plan.errorType }),
    };
    const subject = plan.subject;
    const name =
      subject === undefined || hidden(subject.attribute) ? plan.operation : `${plan.operation} ${subject.value}`;
    const span = options.tracer.startSpan(
      name,
      { kind: plan.kind, attributes: await hash(attributes), startTime: plan.start },
      context,
    );
    const inside = plan.children.length === 0 ? undefined : options.childContext(span);
    for (const child of plan.children) await emit(child, inside);
    if (plan.errorType !== undefined) span.setStatus?.({ code: STATUS_ERROR });
    span.end(plan.end);
  }

  await emit(root, options.parentContext);
}
