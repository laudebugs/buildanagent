/**
 * `@buildanagent/harness/server`: the harness itself. `createHarness()` holds the settings every turn shares,
 * `createDispatcher()` serves the protocol's commands over a harness, and `inProcessTransport()` connects a client in
 * the same process. A stdio transport will carry the same messages later.
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
