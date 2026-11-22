/**
 * `fileMcpPinStore()`: MCP tool pins kept in a project's `extensions.lock.json`, beside the extension pins, so a
 * person reviews and commits both in one file. Node-only: it reads and writes the file.
 */
import type { McpPinStore } from "../mcp/types.js";
import { readMcpPins, writeMcpPins } from "./lock.js";

/**
 * A pin store over the lock file at `lockFile`, such as `.agents/extensions.lock.json`. Writes within this process run
 * one after another, and each replaces the file in one step, keeping its extension pins. A missing file holds no pins.
 * A file another process writes at the same moment can lose one of the two writes.
 */
export function fileMcpPinStore(lockFile: string): McpPinStore {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    read: (server) => readMcpPins(lockFile, server),
    write(server, pins) {
      const next = chain.then(() => writeMcpPins(lockFile, server, pins));
      chain = next.catch(() => {});
      return next;
    },
  };
}
