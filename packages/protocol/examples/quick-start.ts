// The first exchange with a harness: write the `initialize` request that opens a conversation, then read the server's
// answer from the bytes it writes back. A server that speaks the protocol, such as `buildanagent rpc`, answers it.
import { type ClientCommand, decode, encode, type InitializeResult, JsonlFramer } from "@buildanagent/protocol";

const INITIALIZE_ID = 1;

// #region request
/** The line to write to the server's input: who the client is, and no experimental methods. */
export function initializeLine(name: string, version: string): string {
  const initialize: ClientCommand = {
    jsonrpc: "2.0",
    id: INITIALIZE_ID,
    method: "initialize",
    params: { clientInfo: { name, version }, capabilities: [] },
  };
  return encode(initialize);
}
// #endregion

// #region answer
/**
 * Reads `output`, the bytes the server wrote, and returns its answer to `initialize`.
 * Throws a `ProtocolError` for a line that is not a message, and an `Error` when the server answered with an error or
 * wrote no answer.
 */
export function readInitializeAnswer(output: Uint8Array): InitializeResult {
  for (const line of new JsonlFramer().push(output)) {
    if (!line.ok) throw line.error;
    // A string would be parsed a second time by `decode()`, so only an object is a message.
    if (typeof line.value !== "object") continue;
    const message = decode(line.value);
    if ("error" in message) throw new Error(`the server refused initialize: ${message.error.message}`);
    if ("result" in message && message.id === INITIALIZE_ID) return message.result as InitializeResult;
  }
  throw new Error("the server wrote no answer to initialize");
}
// #endregion
