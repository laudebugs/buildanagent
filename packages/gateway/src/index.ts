/**
 * `@buildanagent/gateway`: the model gateway's transcript, model spec, stream rule, runtime, price catalog and
 * helpers.
 *
 * @module @buildanagent/gateway
 */
export {
  type CatalogEntry,
  type CatalogSources,
  defaultCatalog,
  findCatalogEntry,
  type PriceCatalog,
  parseCatalog,
  type RateTier,
  staleCatalogEntries,
} from "./catalog.js";
export { classifyError, type ErrorKind, type FailedRequest } from "./classify.js";
export { complete } from "./complete.js";
export {
  addCost,
  estimateInputTokens,
  type ProjectedTokens,
  priceUsage,
  projectCallCost,
  projectCost,
} from "./cost.js";
export { createModel } from "./create-model.js";
export { GatewayError, type GatewayErrorCode, isGatewayError } from "./errors.js";
export {
  assertCanonicalName,
  CANONICAL_TOOL_NAME,
  createToolNameMap,
  isCanonicalName,
  TOOL_NAME_RULES,
  type ToolNameMap,
  type ToolNameRule,
} from "./names.js";
export { type ResolvedProviderConfig, resolveProviderConfig } from "./provider-config.js";
export {
  assertModelRequestAllowed,
  isMockTransport,
  ModelRequestsDisabledError,
  modelRequestsAreAllowed,
} from "./request-policy.js";
export {
  abortableSleep,
  DEFAULT_INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  retryDelay,
  retryHintMs,
} from "./retry.js";
export type {
  CreateModelOptions,
  DumpedOptions,
  GatewayEvent,
  MiddlewareParams,
  Model,
  ModelCallOptions,
  ModelMiddleware,
  ProviderConfig,
  RequestDump,
  Sleep,
  Transport,
} from "./runtime-types.js";
export type { ModelAdapter, ModelEvent, StreamOptions } from "./spec.js";
export { assertStreamContract, StreamContractError } from "./stream-contract.js";
export { transformMessages } from "./transform-messages.js";
export type {
  AssistantMessage,
  ContentBlock,
  Cost,
  Message,
  ModelCaps,
  ModelContent,
  ModelContext,
  ModelErrorCode,
  ModelRef,
  OpaqueToken,
  Usage,
  WireTool,
} from "./types.js";
export { addUsage, emptyUsage, totalInput, unreportedUsage } from "./usage.js";
