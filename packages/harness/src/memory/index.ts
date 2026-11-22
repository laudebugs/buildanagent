/**
 * `@buildanagent/harness/memory`: long-term memory as a removable extension. `memoryExtension()` adds the `memory` tool
 * over `.agents/memory/` and the index at the start of each run, and `readPurgeMarks()` gives the calls a delete marked,
 * for `purgeSession()` and `pruneSessions()`. The memory folder on disk needs Node's file system, so `fileMemoryFiles()`
 * has its own entry, `@buildanagent/harness/memory/node`.
 */
export { type MemoryExtension, type MemoryExtensionOptions, memoryExtension } from "./extension.js";
export type { MemoryFiles } from "./files.js";
export { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from "./index-text.js";
export { MEMORY_DIR } from "./paths.js";
export {
  MEMORY_EXPIRY_DAYS,
  MEMORY_RECORD_MAX_BYTES,
  type MemoryRecord,
  type MemoryTrust,
  type MemoryType,
  parseRecord,
} from "./record.js";
export { type ClearPurgeMarksOptions, clearPurgeMarks, readPurgeMarks } from "./store.js";
export { MEMORY_TOOL } from "./tool.js";
