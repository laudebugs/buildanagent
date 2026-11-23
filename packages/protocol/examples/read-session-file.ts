// Reads a session file, one entry per line, and counts the entries of each type. `parseEntry()` refuses a line that is
// not an entry, and a header from a format this reader does not know ends the read, so a newer file is never misread.
import { isProtocolError, parseEntry } from "@buildanagent/protocol";

/** What a session file held: how many entries of each type, and the numbers of the lines that were not entries. */
export interface SessionSummary {
  readonly counts: Record<string, number>;
  readonly unreadableLines: number[];
}

// #region read
/**
 * Reads `file`, the text of a session file.
 * Throws a `ProtocolError` with code `unsupported_format_version` for a newer one.
 */
export function summarizeSession(file: string): SessionSummary {
  const summary: SessionSummary = { counts: {}, unreadableLines: [] };
  const lines = file.split("\n");
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    try {
      const entry = parseEntry(line);
      summary.counts[entry.type] = (summary.counts[entry.type] ?? 0) + 1;
    } catch (error) {
      if (!isProtocolError(error) || error.code === "unsupported_format_version") throw error;
      summary.unreadableLines.push(index + 1);
    }
  });
  return summary;
}
// #endregion
