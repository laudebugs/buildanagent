/** The write cap's decision for one tool result: what the model reads instead, and where the full text went. */
import type { ModelContent } from "@buildanagent/gateway";
import { byteLength, capNotice, ENTRY_RESERVE_BYTES, escapedBytes, fitHead, textOf } from "./write-cap.js";

/** The JSON bytes of what a result stores besides its text: its images, its other blocks and its details. */
function otherBytes(content: readonly ModelContent[], details: unknown): number {
  const rest = content.filter((block) => block.type !== "text");
  return byteLength(JSON.stringify({ rest, details: details ?? null }));
}

/** What `capResult()` needs to know about one result. */
export interface CapInput {
  readonly content: readonly ModelContent[];
  readonly details: unknown;
  /** The cap in bytes of the log, from the policy's `writeCapBytes`. */
  readonly cap: number;
  /** The name the spill file takes. */
  readonly name: string;
  /** Stores the full text under `name` and returns its path. It may throw; the result is then cut and the rest is lost. */
  readonly write: (name: string, text: string) => Promise<string>;
}

/** A result's replacement, and the spill that holds the rest when there is one. */
export interface Capped {
  readonly patch: { readonly content?: ModelContent[]; readonly details?: unknown };
  readonly spill?: { readonly path: string; readonly bytes: number };
}

const DETAILS_NOTE = { omitted: "the result's details were over the entry bound" };

/** Whether a spill that holds `text` is needed, or the result already fits once its details are replaced. */
function textFits(content: readonly ModelContent[], room: number): boolean {
  return escapedBytes(textOf(content)) + otherBytes(content, undefined) <= room;
}

/**
 * Caps one result, or returns `undefined` when it already fits. The cap counts the log's bytes, JSON escaping and the
 * result's other blocks and details included, plus room for the entry's own fields, so a capped entry always fits the
 * store. Details that would crowd out the text are replaced by a note; the model never reads them. Image and other
 * non-text blocks that alone take more than half the room are replaced by a note in the text. If the spill store
 * can't write, the text is cut all the same and the notice says the rest was not kept.
 */
export async function capResult(input: CapInput): Promise<Capped | undefined> {
  const { content, details, cap } = input;
  const room = cap - Math.min(ENTRY_RESERVE_BYTES, cap >> 2);
  if (escapedBytes(textOf(content)) + otherBytes(content, details) <= room) return undefined;
  const bigDetails = details !== undefined && byteLength(JSON.stringify(details)) > room >> 2;
  // Only the details are too big: replace them, and the text goes back whole with nothing to spill.
  if (bigDetails && textFits(content, room)) return { patch: { details: DETAILS_NOTE } };
  const text = textOf(content);
  const bytes = byteLength(text);
  const path = await input.write(input.name, text).catch(() => undefined);
  const rest = content.filter((block) => block.type !== "text");
  const dropRest = byteLength(JSON.stringify(rest)) > room >> 1;
  const keptBlocks = dropRest ? [] : rest;
  const kept = otherBytes(keptBlocks, bigDetails ? undefined : details);
  const noticeBytes = escapedBytes(capNotice(room, bytes, path)) + escapedBytes("\n");
  const head = fitHead(text, room - kept - noticeBytes);
  const dropped =
    dropRest && rest.length > 0 ? `\n[${rest.length} image or other block(s) over the entry bound were left out]` : "";
  const notice = `${capNotice(byteLength(head), bytes, path)}${dropped}`;
  return {
    patch: {
      content: [{ type: "text", text: `${head}\n${notice}` }, ...keptBlocks],
      ...(bigDetails ? { details: DETAILS_NOTE } : {}),
    },
    ...(path === undefined ? {} : { spill: { path, bytes } }),
  };
}
