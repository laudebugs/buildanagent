/**
 * `fileMcpPinStore()`: MCP tool pins kept in a project's `extensions.lock.json`, beside the extension pins, so a
 * person reviews and commits both in one file. Node-only: it reads and writes the file.
 */
import type { McpPinStore } from "../mcp/types.js";
import { readMcpPins, writeMcpPins } from "./lock.js";

/**
 * A pin store over the lock file at `lockFile`, such as `.agents/extensions.lock.json`. Every write to one path in
 * this process, through any store or `writeLock()`, runs after the ones before it, and each replaces the file in one
 * step, keeping its extension pins. A missing file holds no pins, and a file that can't be read is refused, not
 * replaced. Two paths that name one file through a link, or a write from another process, can still lose a change.
 */
export function fileMcpPinStore(lockFile: string): McpPinStore {
  return {
    read: (server) => readMcpPins(lockFile, server),
    write: (server, pins) => writeMcpPins(lockFile, server, pins),
  };
}
