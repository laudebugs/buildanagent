/**
 * Builds the Messages API request body from a `ModelContext` (Messages API reference,
 * https://platform.claude.com/docs/en/api/messages/create, as of November 2026).
 *
 * - Messages pass through `transformMessages()` first; tool results become `tool_result` blocks in a user message,
 *   all results of one turn in one message, as the tool-use docs ask. `caps.reasoning` decides only whether the body
 *   asks for thinking: signed Anthropic thinking is replayed either way, because the API checks it against its
 *   signature rather than the model's caps, and dropping it would lose a turn's reasoning for a model the catalog
 *   merely doesn't mark as reasoning.
 * - Tool names go through the run's `ToolNameMap`; tools are sent strict when their schema can be
 *   (`../strict-schema.ts`).
 * - Caching puts at most three `cache_control` breakpoints, on the system prompt, the last tool and the last block
 *   of the last user message, below the API's limit of 4 (Prompt caching,
 *   https://platform.claude.com/docs/en/build-with-claude/prompt-caching, as of November 2026).
 * - `temperature`, `top_p` and `top_k` are never sent: on API version 2026-10-21 any of them is a 400 "even at the
 *   parameter's default value" (https://platform.claude.com/docs/en/api/migration-2026-10-21, as of November 2026).
 */
import { createToolNameMap, TOOL_NAME_RULES, type ToolNameMap } from "../../names.js";
import type { ModelEvent, StreamOptions } from "../../spec.js";
import { transformMessages } from "../../transform-messages.js";
import type { ContentBlock, Message, ModelCaps, ModelContent, ModelContext, ModelRef, WireTool } from "../../types.js";
import { lowerToStrict, type StrictDialect } from "../strict-schema.js";
import { isObject, type Json, toolNames } from "../wire.js";

type Warning = Extract<ModelEvent, { type: "warning" }>;

/** A prefix on an `OpaqueToken` value that marks a `redacted_thinking` block's `data`, not a thinking signature. */
export const REDACTED_THINKING_PREFIX = "redacted_thinking:";

const SAMPLING_PARAMETERS = ["temperature", "top_p", "top_k"] as const;

// Strict tool use keeps optional properties optional and takes these string formats (Structured outputs, "JSON Schema
// limitations"); the request-wide limits are from its "Schema complexity limits" section.
const STRICT_DIALECT: StrictDialect = {
  optional: "keep",
  formats: new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]),
  objectRoot: false,
};
/** The request-wide limits on strict schemas: strict tools, optional properties and union-typed parameters. */
const STRICT_LIMITS = { tools: 20, optional: 24, unions: 16 } as const;

/** What the adapter reads from `providerOptions.anthropic`. */
export interface AnthropicProviderOptions {
  /**
   * Names the conversation, so the adapter can remember a choice that must hold for its later requests. Without it,
   * the adapter recognises a conversation by its system prompt and first message.
   */
  readonly conversationId?: string;
  /**
   * Extra fields for the request body, such as `output_config` or `thinking: { display: "summarized" }`. The fields
   * the adapter sets itself (`model`, `max_tokens`, `stream`, `system`, `messages`, `tools`, and `thinking.type` for a
   * reasoning model) win over these, and sampling fields are dropped; either streams an `unsupported_option` warning.
   */
  readonly extraBody?: Readonly<Record<string, unknown>>;
}

/** One request's body and what reading its response needs. */
export interface RequestPlan {
  readonly body: Json;
  readonly warnings: readonly Warning[];
  readonly names: ToolNameMap;
  /** The TTL the breakpoints asked for, used when a response reports cache writes without their split. */
  readonly cacheTtl: "5m" | "1h";
}

/** Reads `providerOptions.anthropic`, ignoring fields of the wrong type. */
export function anthropicOptions(options: StreamOptions): AnthropicProviderOptions {
  const raw = options.providerOptions?.anthropic;
  if (!isObject(raw)) return {};
  return {
    ...(typeof raw.conversationId === "string" ? { conversationId: raw.conversationId } : {}),
    ...(isObject(raw.extraBody) ? { extraBody: raw.extraBody } : {}),
  };
}

function cacheControlFor(retention: StreamOptions["cacheRetention"]): Json | undefined {
  if (retention === "none") return undefined;
  return retention === "long" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

// Content blocks ------------------------------------------------------------------------------------------------------

function imageBlock(block: Extract<ContentBlock, { type: "image" }>): Json {
  return { type: "image", source: { type: "base64", media_type: block.mediaType, data: block.data } };
}

function userBlock(block: ContentBlock): Json[] {
  if (block.type === "text") return block.text === "" ? [] : [{ type: "text", text: block.text }];
  if (block.type === "image") return [imageBlock(block)];
  return [];
}

function reasoningBlock(block: Extract<ContentBlock, { type: "reasoning" }>): Json[] {
  // An unsigned block cannot pass Anthropic's signature check; transformMessages already drops them for this target.
  const value = block.signature?.value;
  if (value === undefined) return [];
  if (value.startsWith(REDACTED_THINKING_PREFIX)) {
    return [{ type: "redacted_thinking", data: value.slice(REDACTED_THINKING_PREFIX.length) }];
  }
  return [{ type: "thinking", thinking: block.text, signature: value }];
}

function assistantBlock(block: ContentBlock, names: ToolNameMap): Json[] {
  switch (block.type) {
    case "text":
      return block.text === "" ? [] : [{ type: "text", text: block.text }];
    case "reasoning":
      return reasoningBlock(block);
    case "tool_call":
      // A call cut off by the output limit holds its partial JSON as a string; the wire needs an object.
      return [
        {
          type: "tool_use",
          id: block.callId,
          name: names.sanitize(block.name),
          input: isObject(block.input) ? block.input : {},
        },
      ];
    case "image":
      return [];
  }
}

function toolResultBlock(message: Extract<Message, { role: "tool" }>): Json {
  const content = message.content.flatMap((block: ModelContent) => userBlock(block));
  return {
    type: "tool_result",
    tool_use_id: message.callId,
    ...(content.length > 0 ? { content } : {}),
    ...(message.isError ? { is_error: true } : {}),
  };
}

// Messages -----------------------------------------------------------------------------------------------------------

function appendUserBlocks(out: Json[], blocks: Json[]): void {
  if (blocks.length === 0) return;
  const last = out.at(-1);
  if (last?.role === "user" && Array.isArray(last.content)) last.content.push(...blocks);
  else out.push({ role: "user", content: blocks });
}

function encodeMessages(messages: readonly Message[], names: ToolNameMap): Json[] {
  const out: Json[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const content = message.content.flatMap((block) => assistantBlock(block, names));
      if (content.length > 0) out.push({ role: "assistant", content });
    } else {
      appendUserBlocks(out, message.role === "tool" ? [toolResultBlock(message)] : message.content.flatMap(userBlock));
    }
  }
  return out;
}

function markLastUserBlock(messages: Json[], cacheControl: Json): void {
  const lastUser = messages.findLast((message) => message.role === "user");
  const content = lastUser?.content;
  const block = Array.isArray(content) ? content.at(-1) : undefined;
  if (isObject(block)) block.cache_control = cacheControl;
}

// Tools --------------------------------------------------------------------------------------------------------------

function encodeTools(tools: readonly WireTool[], names: ToolNameMap, cacheControl: Json | undefined): Json[] {
  const used = { tools: 0, optional: 0, unions: 0 };
  const encoded = tools.map((tool): Json => {
    const base: Json = {
      name: names.sanitize(tool.name),
      ...(tool.description ? { description: tool.description } : {}),
    };
    const strict = lowerToStrict(tool.inputSchema, STRICT_DIALECT);
    const fits =
      strict !== undefined &&
      used.tools < STRICT_LIMITS.tools &&
      used.optional + strict.optional <= STRICT_LIMITS.optional &&
      used.unions + strict.unions <= STRICT_LIMITS.unions;
    // A tool past the request-wide limits goes without `strict`, so one large schema cannot fail the whole request.
    if (!fits || strict === undefined) return { ...base, input_schema: tool.inputSchema };
    used.tools += 1;
    used.optional += strict.optional;
    used.unions += strict.unions;
    return { ...base, input_schema: strict.schema, strict: true };
  });
  const last = encoded.at(-1);
  if (last && cacheControl) last.cache_control = cacheControl;
  return encoded;
}

// The body -----------------------------------------------------------------------------------------------------------

/** Splits the sampling fields off `extra`, and returns the rest with the names of the fields it dropped. */
function withoutSampling(extra: Readonly<Json>): { rest: Json; dropped: string[] } {
  const rest: Json = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if ((SAMPLING_PARAMETERS as readonly string[]).includes(key)) dropped.push(key);
    else rest[key] = value;
  }
  return { rest, dropped };
}

function samplingWarning(dropped: readonly string[]): Warning[] {
  if (dropped.length === 0) return [];
  return [
    {
      type: "warning",
      code: "unsupported_option",
      message:
        "Anthropic API version 2026-10-21 rejects temperature, top_p and top_k at any value, " +
        `so the request was sent without ${dropped.join(", ")}.`,
    },
  ];
}

// Body fields the adapter always sets from the context and options, so an `extraBody` field of the same name is
// ignored. `thinking` is owned only when the caps ask for it, and then only its `type`.
const ADAPTER_FIELDS = ["model", "max_tokens", "stream", "system", "messages", "tools"] as const;

/**
 * The adapter's own fields over the caller's extras, and the names of the extras they overrode. A caller's `thinking`
 * keeps its other fields, such as `display`, under the adapter's `type: "adaptive"`.
 */
function mergeExtras(own: Json, extras: Json, ownsThinking: boolean): { body: Json; overridden: string[] } {
  const overridden: string[] = ADAPTER_FIELDS.filter((key) => key in extras);
  const body: Json = { ...extras, ...own };
  for (const key of ADAPTER_FIELDS) if (!(key in own)) delete body[key];
  if (ownsThinking) {
    const extra = extras.thinking;
    if (extra !== undefined && !(isObject(extra) && (extra.type === undefined || extra.type === "adaptive"))) {
      overridden.push("thinking.type");
    }
    body.thinking = { ...(isObject(extra) ? extra : {}), type: "adaptive" };
  }
  return { body, overridden };
}

function overrideWarning(overridden: readonly string[]): Warning[] {
  if (overridden.length === 0) return [];
  return [
    {
      type: "warning",
      code: "unsupported_option",
      message:
        `providerOptions.anthropic.extraBody cannot set ${overridden.join(", ")}, ` +
        "which the adapter sets itself, so the request was sent with the adapter's value.",
    },
  ];
}

/** Builds one call's request body. The adapter adds the thinking-binding setting to it before each HTTP request. */
export function buildRequest(
  model: ModelRef,
  context: ModelContext,
  options: StreamOptions,
  caps: ModelCaps,
): RequestPlan {
  // Replay keeps signed thinking whatever caps.reasoning says; the caps decide only the `thinking` field below.
  const messages = transformMessages(context.messages, model, { ...caps, reasoning: true });
  const names = createToolNameMap(TOOL_NAME_RULES.anthropicMessages, toolNames(context, messages));
  const cacheControl = cacheControlFor(options.cacheRetention);
  const wireMessages = encodeMessages(messages, names);
  if (cacheControl) markLastUserBlock(wireMessages, cacheControl);
  const tools = encodeTools(context.tools, names, cacheControl);
  const system =
    context.system === ""
      ? undefined
      : [{ type: "text", text: context.system, ...(cacheControl ? { cache_control: cacheControl } : {}) }];
  const { rest, dropped } = withoutSampling(anthropicOptions(options).extraBody ?? {});
  const own: Json = {
    model: model.id,
    max_tokens: options.maxOutputTokens ?? caps.maxOutputTokens,
    stream: true,
    ...(system ? { system } : {}),
    messages: wireMessages,
    ...(tools.length > 0 ? { tools } : {}),
  };
  const { body, overridden } = mergeExtras(own, rest, caps.reasoning);
  const droppedAll =
    options.temperature === undefined ? dropped : ["temperature", ...dropped.filter((d) => d !== "temperature")];
  return {
    body,
    warnings: [...samplingWarning(droppedAll), ...overrideWarning(overridden)],
    names,
    cacheTtl: options.cacheRetention === "long" ? "1h" : "5m",
  };
}
