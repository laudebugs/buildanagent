/** Layer 1: cap what the model reads of one tool result, and keep the full text in a spill file. */
import type { ModelContent } from "@buildanagent/gateway";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/** The text blocks of a result, joined, and the other blocks (images) left as they are. */
export function textOf(content: readonly ModelContent[]): string {
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/** The first `bytes` bytes of `text`, cut so no UTF-8 character is split. */
export function headBytes(text: string, bytes: number): string {
  const encoded = encoder.encode(text);
  if (encoded.length <= bytes) return text;
  let end = bytes;
  // A continuation byte starts with 10; back up to the byte that begins the character the cut split.
  while (end > 0 && ((encoded[end] as number) & 0b1100_0000) === 0b1000_0000) end--;
  return decoder.decode(encoded.subarray(0, end));
}

/** The byte length of `text` in UTF-8. */
export const byteLength = (text: string): number => encoder.encode(text).length;

/** The line that tells the model where the rest of a capped result went, or that it was not kept. */
export const capNotice = (kept: number, total: number, path: string | undefined): string =>
  path === undefined
    ? `[output cut: the first ${kept} of ${total} bytes are shown; the rest could not be saved]`
    : `[output cut: the first ${kept} of ${total} bytes are shown; the full text is in ${path}]`;

/** The room an entry's own fields (ids, timestamps, the call's name) take beside its content. */
export const ENTRY_RESERVE_BYTES = 1024;

/** The bytes `text` takes inside a JSON string, quotes left out: what a quote, a newline or a control character costs. */
export const escapedBytes = (text: string): number => byteLength(JSON.stringify(text)) - 2;

/**
 * The longest start of `text` whose JSON-escaped form is at most `limit` bytes, cut so no UTF-8 character is split.
 * A text full of newlines or quotes takes more bytes in the log than it has characters, so the cut counts the log's bytes.
 */
export function fitHead(text: string, limit: number): string {
  if (limit <= 0) return "";
  let head = headBytes(text, Math.max(0, limit));
  for (let over = escapedBytes(head) - limit; over > 0; over = escapedBytes(head) - limit) {
    head = headBytes(head, Math.max(0, byteLength(head) - over));
  }
  return head;
}
