/**
 * `@buildanagent/harness`, the buildanagent harness: the session log, context policy, tools, permissions, sandbox,
 * credentials, extensions, memory, telemetry and ablation switches around the SDK's loop.
 * Start with the [quick start](https://docs.buildanagent.fyi/harness/quick-start/).
 *
 * @module @buildanagent/harness
 */
export { HarnessError, type HarnessErrorCode, isHarnessError } from "./errors.js";

/** The package's npm name, `@buildanagent/harness`. */
export const PACKAGE_NAME = "@buildanagent/harness";
