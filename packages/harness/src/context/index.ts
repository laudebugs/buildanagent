/**
 * `@buildanagent/harness/context`: the context layers that keep a long run inside its model's window, cheapest
 * first. `createContextPolicy()` builds the write cap with spill (layer 1) and stepped masking (layer 2); the
 * summary, mid-turn and overflow layers join it in their own todos. A harness takes the policy as `context`.
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
