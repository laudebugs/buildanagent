/** `@buildanagent/gateway`: the model gateway's transcript, model spec, stream rule and helpers. */
export { complete } from "./complete.ts";
export {
  assertModelRequestAllowed,
  isMockTransport,
  ModelRequestsDisabledError,
  modelRequestsAreAllowed,
} from "./request-policy.ts";
export type { Transport } from "./runtime-types.ts";
export type { ModelAdapter, ModelEvent, StreamOptions } from "./spec.ts";
export { assertStreamContract, StreamContractError } from "./stream-contract.ts";
export type {
  AssistantMessage,
  ContentBlock,
  Cost,
  Message,
  ModelCaps,
  ModelContent,
  ModelContext,
  ModelRef,
  OpaqueToken,
  Usage,
  WireTool,
} from "./types.ts";
export { emptyUsage, totalInput } from "./usage.ts";
