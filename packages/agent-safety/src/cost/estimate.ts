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

/** A file a request points at, by URL or by provider reference, so the request holds none of its bytes. */
export interface FileRef {
  /** The URL, or the provider reference as JSON, such as `{"openai":"file-abc"}`. */
  readonly source: string;
  readonly kind: "url" | "reference";
  /** The file's media type, such as `application/pdf`. */
  readonly mediaType: string;
  readonly filename?: string;
}

/** What the caller knows of a file's size: its bytes, or its pages. */
export type FileSize = { readonly bytes: number } | { readonly pages: number };

/** Looks up the size of a file a request points at, or returns `undefined` when it isn't known. */
export type FileSizer = (file: FileRef) => FileSize | undefined | Promise<FileSize | undefined>;

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

const IMAGE: ContentBlock = { type: "image", mediaType: "", data: "" };

/** The file a part points at, or `undefined` when the part carries its data or is an image, which counts without a size. */
function fileRef(data: unknown, mediaType: string, filename: string | undefined): FileRef | undefined {
  if (typeof data !== "object" || data === null || mediaType.startsWith("image/")) return undefined;
  const file = data as { type?: string; url?: unknown; reference?: unknown };
  const named = filename === undefined ? {} : { filename };
  if (file.type === "url") return { kind: "url", source: String(file.url), mediaType, ...named };
  if (file.type === "reference")
    return { kind: "reference", source: JSON.stringify(file.reference), mediaType, ...named };
  return undefined;
}

// A size past these is no file a provider takes, and counting it would build blocks without end, so it counts as
// unknown and the call is refused.
const MAX_BYTES = 2 ** 40;
const MAX_PAGES = 100_000;
// Text counts by characters, so a large size becomes blocks that share one string, never one huge string.
const CHUNK = " ".repeat(2 ** 20);

/** The blocks that a known size stands for: the base64 characters of its bytes, or one image for each page. */
function sizedBlocks(size: FileSize): ContentBlock[] {
  if ("pages" in size) return Array.from({ length: size.pages }, () => IMAGE);
  let chars = Math.ceil(size.bytes / 3) * 4;
  const blocks: ContentBlock[] = [];
  for (; chars >= CHUNK.length; chars -= CHUNK.length) blocks.push({ type: "text", text: CHUNK });
  return [...blocks, { type: "text", text: CHUNK.slice(0, chars) }];
}

/** A caller's size if it is a usable one, a whole number of bytes or pages within bounds; `undefined` otherwise. */
function usableSize(size: unknown): FileSize | undefined {
  if (typeof size !== "object" || size === null) return undefined;
  const { bytes, pages } = size as { bytes?: unknown; pages?: unknown };
  if (typeof bytes === "number" && pages === undefined && Number.isSafeInteger(bytes)) {
    return bytes >= 0 && bytes <= MAX_BYTES ? { bytes } : undefined;
  }
  if (typeof pages === "number" && bytes === undefined && Number.isSafeInteger(pages)) {
    return pages >= 0 && pages <= MAX_PAGES ? { pages } : undefined;
  }
  return undefined;
}

/**
 * The blocks a file counts as. An image becomes an image block, which the gateway counts at the largest per-image size
 * a provider documents; other files count their data's characters. A file sent by URL or by provider reference has no
 * data here, so it counts by the size `sizes` holds for it, and as one image when none is known; `sizeFiles()`
 * lets a caller refuse such a request first.
 */
function fileBlocks(data: unknown, mediaType: string, filename: string | undefined, sizes: SizeTable): ContentBlock[] {
  const ref = fileRef(data, mediaType, filename);
  const known = ref === undefined ? undefined : sizes.get(sizeKey(ref));
  if (known !== undefined) return sizedBlocks(known);
  const chars = fileChars(data);
  if (mediaType.startsWith("image/") || chars === 0) return [IMAGE];
  return [{ type: "text", text: " ".repeat(chars) }];
}

/** The sizes found for a request's files, by `sizeKey()`. */
type SizeTable = ReadonlyMap<string, FileSize>;

const sizeKey = (ref: FileRef): string => `${ref.kind}\u0000${ref.mediaType}\u0000${ref.source}`;

interface FilePart {
  readonly data: unknown;
  readonly mediaType: string;
  readonly filename: string | undefined;
}

/** The file parts of one message part: itself, or the files in the output a tool returned. */
function filesIn(part: Part): FilePart[] {
  if (part.type === "file" || part.type === "reasoning-file") {
    return [{ data: part.data, mediaType: part.mediaType, filename: "filename" in part ? part.filename : undefined }];
  }
  if (part.type !== "tool-result" || part.output.type !== "content") return [];
  return part.output.value.flatMap((item) =>
    item.type === "file" ? [{ data: item.data, mediaType: item.mediaType, filename: undefined }] : [],
  );
}

/** The file parts of a prompt, wherever they sit: in a message, or in the output a tool returned. */
function fileParts(prompt: Prompt): FilePart[] {
  return prompt.flatMap((message) =>
    typeof message.content === "string" ? [] : (message.content as Part[]).flatMap(filesIn),
  );
}

// The sizes a guard remembers, so a tool loop doesn't ask for a file's size on every step.
const REMEMBERED_SIZES = 256;

/**
 * What the guard knows of a prompt's files: the sizes `sizeOf` gave for the files it points at by URL or reference,
 * and the first such file with no usable size, which the caller refuses to send under a cap. A size `sizeOf` gave is
 * kept in `remembered`, so it is asked once for each file while the guard remembers it; a file with no size is asked
 * for again on the next call.
 */
export async function sizeFiles(
  prompt: Prompt,
  sizeOf: FileSizer | undefined,
  remembered: Map<string, FileSize>,
): Promise<{ readonly sizes: SizeTable; readonly unsized: FileRef | undefined }> {
  const sizes = new Map<string, FileSize>();
  let unsized: FileRef | undefined;
  for (const { data, mediaType, filename } of fileParts(prompt)) {
    const ref = fileRef(data, mediaType, filename);
    if (ref === undefined || sizes.has(sizeKey(ref))) continue;
    const key = sizeKey(ref);
    const size = remembered.get(key) ?? usableSize(await sizeOf?.(ref));
    if (size === undefined) {
      unsized ??= ref;
      continue;
    }
    sizes.set(key, size);
    if (remembered.size >= REMEMBERED_SIZES && !remembered.has(key)) {
      remembered.delete(remembered.keys().next().value as string);
    }
    remembered.set(key, size);
  }
  return { sizes, unsized };
}

/**
 * A file's name for a message: its `filename`, else its URL without the query and fragment, which may hold a
 * signature, else the providers its reference names. The full source never reaches an error.
 */
export function describeFile(file: FileRef): string {
  if (file.filename !== undefined) return file.filename;
  if (file.kind === "reference") {
    try {
      const providers = Object.keys(JSON.parse(file.source) as Record<string, unknown>);
      return `a provider reference (${providers.join(", ")})`;
    } catch {
      return "a provider reference";
    }
  }
  try {
    const url = new URL(file.source);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "a file URL";
  }
}

type ToolResult = Extract<Part, { type: "tool-result" }>;

/**
 * The blocks a tool result counts as. A result whose output is content is counted part by part, so an image a tool
 * returns, such as a screenshot, counts as an image and not as its base64 characters.
 */
function toolResultBlocks(part: ToolResult, sizes: SizeTable): ContentBlock[] {
  const { output, ...rest } = part;
  if (output.type !== "content") return [{ type: "text", text: serialise(part) }];
  const header: ContentBlock = { type: "text", text: serialise(rest) };
  return [
    header,
    ...output.value.flatMap((item): ContentBlock[] => {
      if (item.type === "text") return [{ type: "text", text: item.text }];
      if (item.type === "file") return fileBlocks(item.data, item.mediaType, undefined, sizes);
      return [{ type: "text", text: serialise(item) }];
    }),
  ];
}

/** The gateway blocks one AI SDK part counts as. */
function blocks(part: Part, sizes: SizeTable): ContentBlock[] {
  switch (part.type) {
    case "text":
      return [{ type: "text", text: part.text }];
    case "reasoning":
      return [{ type: "reasoning", text: part.text }];
    case "tool-call":
      return [{ type: "tool_call", callId: part.toolCallId, name: part.toolName, input: part.input }];
    case "file":
    case "reasoning-file":
      return fileBlocks(part.data, part.mediaType, "filename" in part ? part.filename : undefined, sizes);
    case "tool-result":
      return toolResultBlocks(part, sizes);
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

function message(prompt: PromptMessage, reported: ReportedCall | undefined, sizes: SizeTable): Message | undefined {
  if (prompt.role === "system") return undefined;
  const content = prompt.content.flatMap((part) => blocks(part as Part, sizes));
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
 * from the provider's own numbers. `sizes` holds the sizes of the files the prompt points at, from `sizeFiles()`.
 */
export function gatewayContext(
  prompt: Prompt,
  tools: readonly CallTool[] | undefined,
  reported: ReportedCall | undefined,
  sizes: SizeTable,
): ModelContext {
  const system = prompt.flatMap((m) => (m.role === "system" ? [m.content] : [])).join("\n");
  const messages = prompt.flatMap((m, i) => message(m, i === reported?.index ? reported : undefined, sizes) ?? []);
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
