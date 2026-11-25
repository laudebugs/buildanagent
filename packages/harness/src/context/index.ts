/**
 * `@buildanagent/harness/context`: the context layers that keep a long run inside its model's window, cheapest
 * first. `createContextPolicy()` builds all five: the write cap with spill, stepped masking, the summary between
 * turns, the mid-turn summary and the retry after an overflow. A harness takes the policy as `context`.
 *
 * @module @buildanagent/harness/context
 */
export { cutoffFor, maskMessages } from "./mask.js";
export { createContextPolicy } from "./policy.js";
export { memorySpillStore } from "./spill.js";
export { SUMMARY_PROMPT_VERSION } from "./summary-template.js";
export type {
  CompactEvent,
  CompactionLog,
  CompactionRecord,
  ContextFill,
  ContextHooks,
  ContextPolicy,
  ContextPolicyOptions,
  LayerName,
  SpillStore,
  SummarizeSettings,
  TurnContext,
  TurnContextOptions,
} from "./types.js";
