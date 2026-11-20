/**
 * Lowering an AI SDK request to the gateway's transcript, so the guard estimates its input with the gateway's own
 * `estimateInputTokens()`, which counts the previous call's reported tokens and estimates only the messages added since
 * from their characters, the rule the SDK's own loop follows.
 */
import {
  type CatalogEntry,
  type ContentBlock,
  type Cost,
  emptyUsage,
  estimateInputTokens,
  type Message,
  type ModelContext,
  priceUsage,
  type Usage,
  unreportedUsage,
  type WireTool,
} from "@buildanagent/gateway";
import type { CallTool, ModelUsage, Prompt, PromptMessage } from "./ai-types.js";

type Part = Exclude<PromptMessage["content"], string>[number];

// Only `MODEL` and the usage of an assistant message reach the estimate; the other fields fill the gateway's type.
const MODEL = { api: "ai-sdk", provider: "ai-sdk", id: "ai-sdk" };
const NO_COST: Cost = { total: null, basis: "unknown", currency: "USD" };

/** The number of characters a file's data would take in a request, or 0 when the request only points at it. */
function fileChars(data: unknown): number {
  if (typeof data !== "object" || data === null) return 0;
  const file = data as { type?: string; data?: unknown; text?: unknown };
  if (file.type === "text" && typeof file.text === "string") return file.text.length;
  if (file.type !== "data") return 0;
  if (typeof file.data === "string") return file.data.length;
  // Raw bytes travel as base64, four characters for every three bytes.
  return file.data instanceof Uint8Array ? Math.ceil(file.data.byteLength / 3) * 4 : 0;
}

/** Serialises a part for its character count, with binary data replaced by a marker so it isn't counted twice. */
function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof Uint8Array ? `<${v.byteLength} bytes>` : v)) ?? "";
}

/**
 * The block a file counts as. An image becomes an image block, which the gateway counts at the largest per-image size
 * a provider documents; other files count their data's characters. A file sent by URL or by provider reference has no
 * size here, so it counts as one image.
 */
function fileBlock(data: unknown, mediaType: string): ContentBlock {
  const chars = fileChars(data);
  if (mediaType.startsWith("image/") || chars === 0) return { type: "image", mediaType: "", data: "" };
  return { type: "text", text: " ".repeat(chars) };
}

type ToolResult = Extract<Part, { type: "tool-result" }>;

/**
 * The blocks a tool result counts as. A result whose output is content is counted part by part, so an image a tool
 * returns, such as a screenshot, counts as an image and not as its base64 characters.
 */
function toolResultBlocks(part: ToolResult): ContentBlock[] {
  const { output, ...rest } = part;
  if (output.type !== "content") return [{ type: "text", text: serialise(part) }];
  const header: ContentBlock = { type: "text", text: serialise(rest) };
  return [
    header,
    ...output.value.map((item): ContentBlock => {
      if (item.type === "text") return { type: "text", text: item.text };
      if (item.type === "file") return fileBlock(item.data, item.mediaType);
      return { type: "text", text: serialise(item) };
    }),
  ];
}

/** The gateway blocks one AI SDK part counts as. */
function blocks(part: Part): ContentBlock[] {
  switch (part.type) {
    case "text":
      return [{ type: "text", text: part.text }];
    case "reasoning":
      return [{ type: "reasoning", text: part.text }];
    case "tool-call":
      return [{ type: "tool_call", callId: part.toolCallId, name: part.toolName, input: part.input }];
    case "file":
    case "reasoning-file":
      return [fileBlock(part.data, part.mediaType)];
    case "tool-result":
      return toolResultBlocks(part);
    default:
      return [{ type: "text", text: serialise(part) }];
  }
}

/** The characters of text, reasoning and tool calls in `content`, measured as the gateway's estimate measures them. */
function contentChars(content: readonly ContentBlock[]): number {
  return content.reduce((sum, block) => {
    if (block.type === "text" || block.type === "reasoning") return sum + block.text.length;
    if (block.type === "tool_call") return sum + block.name.length + JSON.stringify(block.input ?? null).length;
    return sum;
  }, 0);
}

/**
 * A recorded call whose answer the prompt continues: the prompt index of that answer, the call's usage, and the
 * characters of text, reasoning and tool calls the call returned.
 */
export interface ReportedCall {
  readonly index: number;
  readonly usage: Usage;
  readonly responseChars: number;
}

/**
 * The usage that stands in for an assistant message. When the message holds more than the recorded call returned, it
 * isn't that call's answer as returned, so its output counts at least the message's own character estimate.
 */
function standInUsage(content: readonly ContentBlock[], reported: ReportedCall): Usage {
  const { usage } = reported;
  if (contentChars(content) <= reported.responseChars) return usage;
  const own = estimateInputTokens({ system: "", tools: [], messages: [{ role: "user", content: [...content] }] });
  return { ...usage, output: Math.max(usage.output, own) };
}

function message(prompt: PromptMessage, reported: ReportedCall | undefined): Message | undefined {
  if (prompt.role === "system") return undefined;
  const content = prompt.content.flatMap((part) => blocks(part as Part));
  switch (prompt.role) {
    case "user":
      return { role: "user", content };
    case "tool":
      return {
        role: "tool",
        callId: "",
        content: content as Extract<Message, { role: "tool" }>["content"],
        isError: false,
      };
    case "assistant":
      return {
        role: "assistant",
        content,
        model: MODEL,
        stopReason: "stop",
        usage: reported === undefined ? unreportedUsage() : standInUsage(content, reported),
        cost: NO_COST,
      };
  }
}

function wireTool(tool: CallTool): WireTool {
  if (tool.type === "function") {
    return {
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
    };
  }
  return { name: tool.name, description: tool.id, inputSchema: tool.args };
}

/**
 * The gateway context that one AI SDK request stands for. `reported` names the prompt index of the assistant message
 * a recorded call produced, with that call's usage, so `estimateInputTokens()` counts everything up to that message
 * from the provider's own numbers.
 */
export function gatewayContext(
  prompt: Prompt,
  tools: readonly CallTool[] | undefined,
  reported?: ReportedCall,
): ModelContext {
  const system = prompt.flatMap((m) => (m.role === "system" ? [m.content] : [])).join("\n");
  const messages = prompt.flatMap((m, i) => message(m, i === reported?.index ? reported : undefined) ?? []);
  return { system, messages, tools: (tools ?? []).map(wireTool) };
}

/** One key per message, equal for two messages only when they are the same, to recognise a prompt a call continues. */
export function messageKeys(prompt: Prompt): string[] {
  return prompt.map(serialise);
}

/** A key for the tools a request offers, equal for two requests only when they offer the same tools. */
export function toolsKey(tools: readonly CallTool[] | undefined): string {
  return serialise(tools ?? []);
}

/** The characters of text, reasoning and tool calls in a response part, measured as `contentChars()` measures them. */
export function responsePartChars(part: { readonly type: string }): number {
  const p = part as { type: string; text?: unknown; delta?: unknown; toolName?: unknown; input?: unknown };
  if ((p.type === "text" || p.type === "reasoning") && typeof p.text === "string") return p.text.length;
  if ((p.type === "text-delta" || p.type === "reasoning-delta") && typeof p.delta === "string") return p.delta.length;
  if (p.type === "tool-call" && typeof p.toolName === "string" && typeof p.input === "string") {
    return p.toolName.length + p.input.length;
  }
  return 0;
}

/**
 * The gateway's usage record for an AI SDK response, or an unreported one when the provider left out the input or
 * output total. A missing breakdown is derived from the totals: uncached input is the input left after cache reads and
 * writes, and every cache write counts as a short-lived one, which `priceResponse()` prices at the dearer lifetime.
 */
export function gatewayUsage(usage: ModelUsage | undefined): Usage {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  if (input?.total === undefined || output?.total === undefined) return unreportedUsage(usage ?? null);
  const cacheRead = input.cacheRead ?? 0;
  const cacheWrite = input.cacheWrite ?? 0;
  return {
    ...emptyUsage(usage?.raw ?? null),
    uncachedInput: input.noCache ?? Math.max(0, input.total - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite: { "5m": cacheWrite, "1h": 0 },
    output: output.total,
    reasoning: output.reasoning ?? 0,
  };
}

/**
 * The response's price in USD, or `null` when its usage is unreported. The AI SDK reports cache writes as one count,
 * so they are priced at whichever of the short and long write rates costs more, which errs towards a higher spend.
 */
export function priceResponse(usage: Usage, entry: CatalogEntry): number | null {
  const short = priceUsage(usage, entry).total;
  const long = priceUsage({ ...usage, cacheWrite: { "5m": 0, "1h": usage.cacheWrite["5m"] } }, entry).total;
  if (short === null || long === null) return null;
  return Math.max(short, long);
}
