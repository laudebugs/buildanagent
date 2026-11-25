/**
 * `@buildanagent/harness/permissions`: the permission pipeline that decides every tool call. It runs hooks, deny rules,
 * ask rules, the mode, allow rules and a host callback in that order, and a call no rule settles asks when a person can
 * answer and is denied when none can.
 *
 * @module @buildanagent/harness/permissions
 */
export { defaultAskRules } from "./default-rules.js";
export { PermissionConfigError } from "./errors.js";
export { createPermissionPipeline } from "./pipeline.js";
export type {
  Decision,
  HookDecision,
  PermissionConfig,
  PermissionHook,
  PermissionMode,
  PermissionPipeline,
  PolicyContext,
  PolicyInput,
  PolicySession,
  RecordedEntry,
  Rule,
  ToolCall,
} from "./types.js";
