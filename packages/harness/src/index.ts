/** `@buildanagent/harness`, the buildanagent harness: the session log, context policy, tools, permissions, sandbox and credentials around the SDK's loop. Only the sandbox is built so far; every other subpath holds its place. */
export { HarnessError, type HarnessErrorCode, isHarnessError } from "./errors.js";

export const PACKAGE_NAME = "@buildanagent/harness";
