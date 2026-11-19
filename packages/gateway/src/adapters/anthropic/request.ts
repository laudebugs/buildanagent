/**
 * Builds the Messages API request body from a `ModelContext` (Messages API reference,
 * https://platform.claude.com/docs/en/api/messages/create, as of November 2026).
 *
 * - Messages pass through `transformMessages()` first; tool results become `tool_result` blocks in a user message,
 *   all results of one turn in one message, as the tool-use docs ask.
 * - Tool names go through the run's `ToolNameMap`; tools are sent strict when their schema can be (strict-schema.ts).
 * - Caching puts at most three `cache_control` breakpoints, on the system prompt, the last tool and the last block
 *   of the last user message, below the API's limit of 4 (Prompt caching,
 *   https://platform.claude.com/docs/en/build-with-claude/prompt-caching, as of November 2026).
 * - `temperature`, `top_p` and `top_k` are never sent: on API version 2026-10-21 any of them is a 400 "even at the
 *   parameter's default value" (https://platform.claude.com/docs/en/api/migration-2026-10-21, as of November 2026).
 */
import { createToolNameMap, TOOL_NAME_RULES, type ToolNameMap } from "../../names.ts";
import type { ModelEvent, StreamOptions } from "../../spec.ts";
import { transformMessages } from "../../transform-messages.ts";
import type { ContentBlock, Message, ModelCaps, ModelContent, ModelContext, ModelRef, WireTool } from "../../types.ts";
import { lowerToStrict, STRICT_LIMITS } from "./strict-schema.ts";

type Json = Record<string, unknown>;
type Warning = Extract<ModelEvent, { type: "warning" }>;

/** A prefix on an `OpaqueToken` value that marks a `redacted_thinking` block's `data`, not a thinking signature. */
export const REDACTED_THINKING_PREFIX = "redacted_thinking:";

const SAMPLING_PARAMETERS = ["temperature", "top_p", "top_k"] as const;

/** What the adapter reads from `providerOptions.anthropic`. */
export interface AnthropicProviderOptions {
  /**
   * Names the conversation, so the adapter can remember a choice that must hold for its later requests. Without it,
   * the adapter recognises a conversation by its system prompt and first message.
   */
  readonly conversationId?: string;
  /** Fields merged into the request body last, such as `thinking` or `output_config`. Sampling fields are dropped. */
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

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const strict = lowerToStrict(tool.inputSchema);
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

function toolNames(context: ModelContext, messages: readonly Message[]): string[] {
  const called = messages.flatMap((message) =>
    message.role === "assistant" ? message.content.flatMap((b) => (b.type === "tool_call" ? [b.name] : [])) : [],
  );
  return [...context.tools.map((tool) => tool.name), ...called];
}

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

/** Builds one call's request body. The adapter adds the thinking-binding setting to it before each HTTP request. */
export function buildRequest(
  model: ModelRef,
  context: ModelContext,
  options: StreamOptions,
  caps: ModelCaps,
): RequestPlan {
  const messages = transformMessages(context.messages, model, caps);
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
  const body: Json = {
    model: model.id,
    max_tokens: options.maxOutputTokens ?? caps.maxOutputTokens,
    stream: true,
    ...(system ? { system } : {}),
    messages: wireMessages,
    ...(tools.length > 0 ? { tools } : {}),
    ...(caps.reasoning ? { thinking: { type: "adaptive" } } : {}),
    ...rest,
  };
  const droppedAll =
    options.temperature === undefined ? dropped : ["temperature", ...dropped.filter((d) => d !== "temperature")];
  return {
    body,
    warnings: samplingWarning(droppedAll),
    names,
    cacheTtl: options.cacheRetention === "long" ? "1h" : "5m",
  };
}
