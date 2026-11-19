/**
 * Builds the Chat Completions request body from a `ModelContext`. OpenAI's docs host was unreachable from our build
 * environment, so every field below follows `ChatCompletionCreateParams` and the message, content-part and tool types
 * in openai-node v7.49.0 (`src/resources/chat/completions/completions.ts` and `src/resources/shared.ts`, as of
 * November 2026), whose comments link the API reference at
 * https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create.
 *
 * - Messages pass through `transformMessages()` first. A tool result becomes a `tool` message, whose content can hold
 *   only text, so a result's images follow in one user message after the turn's results. The transcript's reasoning
 *   is never sent, because a Chat Completions message has no field for it.
 * - Tool names go through the run's `ToolNameMap`. A tool is sent with `strict: true` when its schema can be lowered,
 *   and the plan keeps the original schema of each, so the reply's added nulls can be stripped.
 * - Caching follows the model's `ChatCompat` flags: explicit breakpoints on the system prompt and the newest user or
 *   tool message, `prompt_cache_retention: "24h"`, or neither, which leaves the server's automatic prefix cache.
 */
import { createToolNameMap, TOOL_NAME_RULES, type ToolNameMap } from "../../names.js";
import type { ModelEvent, StreamOptions } from "../../spec.js";
import { transformMessages } from "../../transform-messages.js";
import type { ContentBlock, Message, ModelCaps, ModelContext, ModelRef, WireTool } from "../../types.js";
import { lowerToStrict, type StrictDialect } from "../strict-schema.js";
import { isObject, type Json } from "../wire.js";
import type { ResolvedCompat } from "./compat.js";

type Warning = Extract<ModelEvent, { type: "warning" }>;

/** What the adapter reads from `providerOptions.openaiChat`. */
export interface OpenAIChatProviderOptions {
  /**
   * Extra fields for the request body, such as `reasoning_effort`, `prompt_cache_key` or `parallel_tool_calls`. The
   * fields the adapter sets itself (`model`, `stream`, `stream_options`, `messages`, `tools` and the output-limit
   * field) win over these, and an `extraBody` that sets one streams an `unsupported_option` warning.
   */
  readonly extraBody?: Readonly<Record<string, unknown>>;
}

/** One request's body and what reading its response needs. */
export interface RequestPlan {
  readonly body: Json;
  readonly warnings: readonly Warning[];
  readonly names: ToolNameMap;
  /** The original input schema of each tool sent strict, by tool name. */
  readonly strictSchemas: ReadonlyMap<string, Json>;
  /** The `Usage.cacheWrite` key the reply's cache writes count under: `"1h"` for 12-hour breakpoints. */
  readonly cacheSlot: "5m" | "1h";
}

// Strict function calling makes every property required, so an optional one becomes nullable. The formats are the
// ones Anthropic and OpenAI's structured outputs have both documented; `uri` is left out, because OpenAI's list could
// not be checked.
const STRICT_DIALECT: StrictDialect = {
  optional: "nullable",
  formats: new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]),
  objectRoot: true,
};

const TOOL_IMAGES_NOTE = "The images below are part of the tool results above.";

/** Reads `providerOptions.openaiChat`, ignoring fields of the wrong type. */
export function openaiChatOptions(options: StreamOptions): OpenAIChatProviderOptions {
  const raw = options.providerOptions?.openaiChat;
  if (!isObject(raw)) return {};
  return isObject(raw.extraBody) ? { extraBody: raw.extraBody } : {};
}

// Content -------------------------------------------------------------------------------------------------------------

function imagePart(block: Extract<ContentBlock, { type: "image" }>): Json {
  return { type: "image_url", image_url: { url: `data:${block.mediaType};base64,${block.data}` } };
}

function contentPart(block: ContentBlock): Json[] {
  if (block.type === "text") return block.text === "" ? [] : [{ type: "text", text: block.text }];
  return block.type === "image" ? [imagePart(block)] : [];
}

/** A user message's content: a plain string for a single text block, which every compatible server reads. */
function userContent(blocks: readonly ContentBlock[]): string | Json[] {
  const [only] = blocks;
  if (blocks.length === 1 && only?.type === "text") return only.text;
  return blocks.flatMap(contentPart);
}

function assistantMessage(message: Extract<Message, { role: "assistant" }>, names: ToolNameMap): Json | undefined {
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const toolCalls = message.content.flatMap((block): Json[] => {
    if (block.type !== "tool_call") return [];
    // A call cut off by the output limit holds its partial JSON as a string; the wire needs a JSON object.
    const input = isObject(block.input) ? block.input : {};
    return [
      {
        id: block.callId,
        type: "function",
        function: { name: names.sanitize(block.name), arguments: JSON.stringify(input) },
      },
    ];
  });
  if (text === "" && toolCalls.length === 0) return undefined;
  return {
    role: "assistant",
    content: text === "" ? null : text,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function toolMessage(message: Extract<Message, { role: "tool" }>): Json {
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  return { role: "tool", tool_call_id: message.callId, content: text };
}

/** Encodes the transcript; a run of tool results is followed by one user message with their images, if any. */
function encodeMessages(messages: readonly Message[], names: ToolNameMap): Json[] {
  const out: Json[] = [];
  let images: Json[] = [];
  const flushImages = () => {
    if (images.length > 0) out.push({ role: "user", content: [{ type: "text", text: TOOL_IMAGES_NOTE }, ...images] });
    images = [];
  };
  for (const message of messages) {
    if (message.role === "tool") {
      out.push(toolMessage(message));
      images.push(...message.content.flatMap((block) => (block.type === "image" ? [imagePart(block)] : [])));
      continue;
    }
    flushImages();
    const encoded =
      message.role === "user"
        ? { role: "user", content: userContent(message.content) }
        : assistantMessage(message, names);
    if (encoded) out.push(encoded);
  }
  flushImages();
  return out;
}

// Caching ------------------------------------------------------------------------------------------------------------

/** Puts the breakpoint on the last content part of a message, turning string content into one text part. */
function markMessage(message: Json, breakpoint: Json): void {
  if (typeof message.content === "string") {
    message.content = [{ type: "text", text: message.content, prompt_cache_breakpoint: breakpoint }];
    return;
  }
  const last = Array.isArray(message.content) ? message.content.at(-1) : undefined;
  if (isObject(last)) last.prompt_cache_breakpoint = breakpoint;
}

/** The caching fields for the body, after marking the messages that take a breakpoint. */
function applyCaching(messages: Json[], retention: StreamOptions["cacheRetention"], compat: ResolvedCompat): Json {
  if (compat.cacheBreakpoints) {
    // Explicit mode with no breakpoint turns caching off; implicit mode adds the server's own breakpoint to ours.
    if (retention === "none") return { prompt_cache_options: { mode: "explicit" } };
    const breakpoint = retention === "long" ? { mode: "explicit", ttl: "12h" } : { mode: "explicit" };
    const system = messages[0]?.role === compat.systemRole ? messages[0] : undefined;
    const newest = messages.findLast((message) => message.role === "user" || message.role === "tool");
    for (const message of new Set([system, newest])) if (message) markMessage(message, breakpoint);
    return {};
  }
  return retention === "long" && compat.promptCacheRetention ? { prompt_cache_retention: "24h" } : {};
}

// Tools --------------------------------------------------------------------------------------------------------------

function encodeTools(tools: readonly WireTool[], names: ToolNameMap, compat: ResolvedCompat) {
  const strictSchemas = new Map<string, Json>();
  const encoded = tools.map((tool): Json => {
    const strict = compat.strictTools ? lowerToStrict(tool.inputSchema, STRICT_DIALECT) : undefined;
    if (strict) strictSchemas.set(tool.name, tool.inputSchema);
    const definition: Json = {
      name: names.sanitize(tool.name),
      ...(tool.description ? { description: tool.description } : {}),
      parameters: strict ? strict.schema : tool.inputSchema,
      ...(strict ? { strict: true } : {}),
    };
    return { type: "function", function: definition };
  });
  return { encoded, strictSchemas };
}

// The body -----------------------------------------------------------------------------------------------------------

function toolNames(context: ModelContext, messages: readonly Message[]): string[] {
  const called = messages.flatMap((message) =>
    message.role === "assistant" ? message.content.flatMap((b) => (b.type === "tool_call" ? [b.name] : [])) : [],
  );
  return [...context.tools.map((tool) => tool.name), ...called];
}

function warning(message: string): Warning {
  return { type: "warning", code: "unsupported_option", message };
}

/** The adapter's own fields over the caller's extras, with a warning naming any extra they overrode. */
function mergeExtras(own: Json, extras: Readonly<Json>, owned: readonly string[]): { body: Json; warnings: Warning[] } {
  const overridden = owned.filter((key) => key in extras);
  const body: Json = { ...extras, ...own };
  for (const key of owned) if (!(key in own)) delete body[key];
  const warnings =
    overridden.length === 0
      ? []
      : [
          warning(
            `providerOptions.openaiChat.extraBody cannot set ${overridden.join(", ")}, ` +
              "which the adapter sets itself, so the request was sent with the adapter's value.",
          ),
        ];
  return { body, warnings };
}

function samplingFields(options: StreamOptions, model: ModelRef, compat: ResolvedCompat) {
  if (options.temperature === undefined) return { fields: {}, warnings: [] };
  if (compat.temperature) return { fields: { temperature: options.temperature }, warnings: [] };
  const text = `${model.id} does not accept temperature, so the request was sent without it.`;
  return { fields: {}, warnings: [warning(text)] };
}

/** Builds one call's request body. */
export function buildRequest(
  model: ModelRef,
  context: ModelContext,
  options: StreamOptions,
  caps: ModelCaps,
  compat: ResolvedCompat,
): RequestPlan {
  const messages = transformMessages(context.messages, model, caps);
  const names = createToolNameMap(TOOL_NAME_RULES.openaiChat, toolNames(context, messages));
  const system = context.system === "" ? [] : [{ role: compat.systemRole, content: context.system }];
  const wireMessages = [...system, ...encodeMessages(messages, names)];
  const caching = applyCaching(wireMessages, options.cacheRetention, compat);
  const tools = encodeTools(context.tools, names, compat);
  const sampling = samplingFields(options, model, compat);
  const own: Json = {
    model: model.id,
    stream: true,
    ...(compat.streamUsage ? { stream_options: { include_usage: true } } : {}),
    messages: wireMessages,
    ...(tools.encoded.length > 0 ? { tools: tools.encoded } : {}),
    [compat.maxTokensField]: options.maxOutputTokens ?? caps.maxOutputTokens,
    ...sampling.fields,
    ...caching,
  };
  const owned = ["model", "stream", "stream_options", "messages", "tools", compat.maxTokensField];
  const { body, warnings } = mergeExtras(own, openaiChatOptions(options).extraBody ?? {}, owned);
  return {
    body,
    warnings: [...sampling.warnings, ...warnings],
    names,
    strictSchemas: tools.strictSchemas,
    cacheSlot: compat.cacheBreakpoints && options.cacheRetention === "long" ? "1h" : "5m",
  };
}
