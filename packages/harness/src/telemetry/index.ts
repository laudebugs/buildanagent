/**
 * `@buildanagent/harness/telemetry`: spans projected from the session log, with content off by default, and the session
 * budget meter. The conventions' attribute names come from `@buildanagent/sdk/otel`; this module adds only the
 * `buildanagent.*` names.
 *
 * @module @buildanagent/harness/telemetry
 */
export { BUILDANAGENT_ATTRIBUTES } from "./attributes.js";
export {
  type BudgetMeter,
  type BudgetMeterOptions,
  type BudgetWarning,
  budgetMeterFromEntries,
  createBudgetMeter,
  DEFAULT_WARN_AT,
} from "./budget.js";
export type { ContentLevel } from "./plan.js";
export { type ProjectSpansOptions, projectSpans } from "./project.js";
