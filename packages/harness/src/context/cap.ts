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
  /** Stores the full text under `name` and returns its path. */
  readonly write: (name: string, text: string) => Promise<string>;
}

/** A result's replacement content, and the spill that holds the rest. */
export interface Capped {
  readonly patch: { readonly content: ModelContent[]; readonly details?: unknown };
  readonly spill: { readonly path: string; readonly bytes: number };
}

/**
 * Caps one result, or returns `undefined` when it already fits. The cap counts the log's bytes, JSON escaping and the
 * result's other blocks and details included, plus room for the entry's own fields, so a capped entry always fits the
 * store. Details that would crowd out the text are replaced by a note; the model never reads them.
 */
export async function capResult(input: CapInput): Promise<Capped | undefined> {
  const { content, details, cap } = input;
  const text = textOf(content);
  const room = cap - Math.min(ENTRY_RESERVE_BYTES, cap >> 2);
  const others = otherBytes(content, details);
  if (escapedBytes(text) + others <= room) return undefined;
  const bytes = byteLength(text);
  const path = await input.write(input.name, text);
  const dropDetails = details !== undefined && byteLength(JSON.stringify(details)) > room >> 2;
  const kept = dropDetails ? otherBytes(content, undefined) : others;
  const noticeBytes = escapedBytes(capNotice(room, bytes, path)) + escapedBytes("\n");
  const head = fitHead(text, room - kept - noticeBytes);
  const images = content.filter((block) => block.type !== "text");
  const notice = capNotice(byteLength(head), bytes, path);
  return {
    patch: {
      content: [{ type: "text", text: `${head}\n${notice}` }, ...images],
      ...(dropDetails ? { details: { omitted: "the result's details were over the entry bound" } } : {}),
    },
    spill: { path, bytes },
  };
}
