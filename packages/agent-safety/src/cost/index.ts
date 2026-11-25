/**
 * `@buildanagent/agent-safety/cost`: a USD cap for the Vercel AI SDK, checked before each model call. `costGuard()` is
 * a language-model middleware that refuses a call with `BudgetExceeded` when the spend so far plus the call's
 * projected cost would pass the cap, and `guardedProvider()` applies it to every model of a provider. The projection
 * is the gateway's, so this cap and the SDK's `budgetUsd` agree. This subpath imports `ai`, an optional peer
 * dependency, and `@buildanagent/gateway`.
 *
 * @module @buildanagent/agent-safety/cost
 */
export { BudgetExceeded, type BudgetRefusalCode, type BudgetRefusalInit, budgetRefusal } from "./budget-exceeded.js";
export { type CostGuardOptions, costGuard, type GuardedCall } from "./cost-guard.js";
export type { FileRef, FileSize, FileSizer } from "./estimate.js";
export {
  type GuardableModel,
  type GuardableProvider,
  type GuardedModel,
  type GuardedProvider,
  guardedModel,
  guardedProvider,
} from "./guarded-provider.js";
export { memorySpend, type Spend } from "./spend.js";
