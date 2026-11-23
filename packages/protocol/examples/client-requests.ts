// Writes the two requests a client sends to open a session and start a turn, and says what each kind of message the
// server sends back means. The types make a wrong method name or a missing field a compile error.
import { type ClientCommand, encode, type ServerMessage } from "@buildanagent/protocol";

const CREATE_ID = 1;
const START_ID = 2;

// #region requests
/** The lines to write to the server: `session/create` for `cwd`, then `turn/start` with `text` as its input. */
export function requestLines(cwd: string, session: string, text: string): string[] {
  const create: ClientCommand = { jsonrpc: "2.0", id: CREATE_ID, method: "session/create", params: { session, cwd } };
  const start: ClientCommand = {
    jsonrpc: "2.0",
    id: START_ID,
    method: "turn/start",
    params: { session, input: [{ type: "text", text }] },
  };
  return [encode(create), encode(start)];
}
// #endregion

// #region reply
/** What one server message is: an error, an answer, a request to answer, or a notification to read. */
export function describeServerMessage(message: ServerMessage): string {
  if ("error" in message) return `error ${message.error.code}: ${message.error.message}`;
  if ("result" in message) return `answer to request ${message.id}`;
  if ("id" in message) return `the server asks ${message.method}`;
  if (message.method === "turn/settled")
    return `turn ${message.params.turn} ended: ${message.params.result.stopReason}`;
  return message.method === "event" ? `event ${message.params.seq}` : `request ${message.params.id} withdrawn`;
}
// #endregion
