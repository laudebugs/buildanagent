/**
 * `@buildanagent/harness/server`: the harness itself. `createHarness()` holds the settings every turn shares,
 * `createDispatcher()` serves the protocol's commands over a harness, and `inProcessTransport()` connects a client in
 * the same process. `stdioTransport()` serves one client over a pair of byte streams, one JSON-RPC message per line.
 */
export { createHarness, type Harness, type HarnessEnv, type HarnessOptions } from "../harness.js";
export {
  type Connection,
  type ConnectOptions,
  createDispatcher,
  type Dispatcher,
  type DispatcherOptions,
  EXPERIMENTAL_METHODS,
} from "./dispatcher.js";
export { type InProcessClient, inProcessTransport, type RequestOptions, RpcFailure } from "./local-transport.js";
export type { Deliver } from "./outbox.js";
export {
  type NodeInput,
  type NodeOutput,
  type StdioInput,
  type StdioIo,
  type StdioOptions,
  type StdioOutput,
  stdioTransport,
} from "./stdio.js";
