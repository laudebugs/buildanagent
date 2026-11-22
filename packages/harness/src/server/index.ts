/**
 * `@buildanagent/harness/server`: the harness itself. `createHarness()` holds the settings every turn shares,
 * `createDispatcher()` serves the protocol's commands over a harness, and `inProcessTransport()` connects a client in
 * the same process. The stdio transport arrives with its own todo.
 */
export { createHarness, type Harness, type HarnessEnv, type HarnessOptions } from "../harness.js";
export {
  type Connection,
  createDispatcher,
  type Dispatcher,
  type DispatcherOptions,
  EXPERIMENTAL_METHODS,
} from "./dispatcher.js";
export { type InProcessClient, inProcessTransport, RpcFailure } from "./local-transport.js";
