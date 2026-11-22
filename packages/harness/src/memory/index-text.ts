/**
 * The memory index: one line per record that still holds, with its subject, type, trust and path, cut at 200 lines or
 * 25 KiB. It never holds a fact, only the subject, so the model views a record, and sees its source, before it acts on
 * it.
 */
import { MEMORY_DIR, shownPath } from "./paths.js";
import type { NamedRecord } from "./store.js";

/** The most lines of the index, the heading and the left-out note included. */
export const MEMORY_INDEX_MAX_LINES = 200;
/** The most bytes of the index as UTF-8, the heading and the left-out note included. */
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;

const SUBJECT_MAX = 200;
const ENCODER = new TextEncoder();
const bytes = (text: string): number => ENCODER.encode(text).length;

/** The subject on one line: control and format characters become spaces, and a long one is cut. */
function oneLine(text: string): string {
  const flat = text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").trim();
  return flat.length > SUBJECT_MAX ? `${flat.slice(0, SUBJECT_MAX)}...` : flat;
}

/** A record's line in the index, and in a `view` of a folder. */
export function indexLine({ name, record }: NamedRecord): string {
  const trust = record.trust === "low" ? "low trust" : "trusted";
  return `- ${oneLine(record.subject)} (${record.type}, ${trust}): ${shownPath(name)}`;
}

/**
 * Trusted records first, then the most recently validated, then by path, so the records the cap keeps are the ones
 * most worth keeping, and the same records give the same bytes.
 */
export function ordered(records: readonly NamedRecord[]): NamedRecord[] {
  return [...records].sort(
    (a, b) =>
      Number(a.record.trust === "low") - Number(b.record.trust === "low") ||
      b.record.validated.localeCompare(a.record.validated) ||
      a.name.localeCompare(b.name),
  );
}

const leftOut = (count: number): string =>
  `[${count} more record${count === 1 ? " is" : "s are"} left out, because the index stops at ${MEMORY_INDEX_MAX_LINES} lines or ${MEMORY_INDEX_MAX_BYTES} bytes; find them with grep or glob under ${MEMORY_DIR}/]`;

/**
 * The index's text for `records`, or `""` when there are none. Lines are added while the text, with room for the note
 * that says how many were left out, stays within both caps.
 */
export function indexText(records: readonly NamedRecord[]): string {
  if (records.length === 0) return "";
  const heading = `Memory index: ${records.length} record${records.length === 1 ? "" : "s"} in ${MEMORY_DIR}/. Each is a claim from an earlier session: view a record to see its fact, its source and when it was last validated, and check the source before you act on it.`;
  const lines = [heading];
  let size = bytes(heading);
  const all = ordered(records);
  for (const [at, record] of all.entries()) {
    const line = indexLine(record);
    const rest = all.length - at - 1;
    // The note for the records after this one must still fit, unless this is the last record.
    const note = rest === 0 ? 0 : 1 + bytes(leftOut(rest));
    if (
      lines.length + 1 + (rest === 0 ? 0 : 1) > MEMORY_INDEX_MAX_LINES ||
      size + 1 + bytes(line) + note > MEMORY_INDEX_MAX_BYTES
    ) {
      lines.push(leftOut(all.length - at));
      break;
    }
    lines.push(line);
    size += 1 + bytes(line);
  }
  return lines.join("\n");
}
