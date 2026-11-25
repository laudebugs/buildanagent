/**
 * `@buildanagent/harness/server`: the harness itself. `createHarness()` holds the settings every turn shares,
 * `createDispatcher()` serves the protocol's commands over a harness, and `inProcessTransport()` connects a client in
 * the same process. `stdioTransport()` serves one client over a pair of byte streams, one JSON-RPC message per line,
 * and `webSocketTransport()` serves one client over a WebSocket, one message per text frame.
 *
 * @module @buildanagent/harness/server
 */
export { createHarness } from "../create-harness.js";
export type { CodeCall, CodeCallResult, Harness, HarnessEnv, HarnessOptions } from "../harness.js";
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
export {
  type WebSocketCloseEvent,
  type WebSocketLike,
  type WebSocketMessageEvent,
  type WebSocketOptions,
  webSocketTransport,
} from "./websocket.js";
