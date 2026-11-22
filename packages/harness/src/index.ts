/** `@buildanagent/harness`, the buildanagent harness: the session log, context policy, tools, permissions, sandbox and credentials around the SDK's loop. The `mcp`, `memory`, `telemetry` and `ablation` subpaths are stubs that hold their place until their components are built. */
export { HarnessError, type HarnessErrorCode, isHarnessError } from "./errors.js";

/** The package's npm name, `@buildanagent/harness`. */
export const PACKAGE_NAME = "@buildanagent/harness";
