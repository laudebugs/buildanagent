/**
 * `@buildanagent/gateway`: the model gateway's transcript, model spec, stream rule, runtime, price catalog and
 * helpers.
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
} from "./catalog.ts";
export { classifyError, type ErrorKind, type FailedRequest } from "./classify.ts";
export { complete } from "./complete.ts";
export { estimateInputTokens, type ProjectedTokens, priceUsage, projectCallCost, projectCost } from "./cost.ts";
export { createModel } from "./create-model.ts";
export { GatewayError, type GatewayErrorCode, isGatewayError } from "./errors.ts";
export { type ResolvedProviderConfig, resolveProviderConfig } from "./provider-config.ts";
export {
  assertModelRequestAllowed,
  isMockTransport,
  ModelRequestsDisabledError,
  modelRequestsAreAllowed,
} from "./request-policy.ts";
export type {
  CreateModelOptions,
  DumpedOptions,
  GatewayEvent,
  MiddlewareParams,
  Model,
  ModelMiddleware,
  ProviderConfig,
  RequestDump,
  Sleep,
  Transport,
} from "./runtime-types.ts";
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
export { addUsage, emptyUsage, totalInput } from "./usage.ts";
