// A client on the far end of an in-memory socket, and a transport started on the near end, for the WebSocket tests.
import assert from "node:assert/strict";
import { type Dispatcher, type WebSocketOptions, webSocketTransport } from "@buildanagent/harness/server";
import { decode, type ServerMessage } from "@buildanagent/protocol";
import { MemorySocket } from "./memory-websocket.js";
import { until } from "./server-helpers.js";

export interface WsRun {
  readonly server: MemorySocket;
  readonly client: MemorySocket;
  /** Every frame the client got, as sent. */
  readonly frames: unknown[];
  /** Every frame the client got, decoded strictly. */
  readonly messages: () => ServerMessage[];
  readonly logs: string[];
  /** The close codes the client saw. */
  readonly closes: number[];
  readonly done: Promise<void>;
  readonly finished: () => boolean;
  /** Sends one message as a text frame. */
  send(message: unknown): void;
  /** Sends a request and waits for the response with its id. */
  request(id: number, method: string, params: unknown): Promise<ServerMessage>;
}

/** Starts `webSocketTransport()` on one end of a new pair and records what the other end gets. */
export function wsRun(dispatcher: Dispatcher, options: Omit<WebSocketOptions, "log"> = {}): WsRun {
  const [server, client] = MemorySocket.pair();
  return wsRunOn(dispatcher, server, client, options);
}

/** As `wsRun()`, over a pair the test already holds. */
export function wsRunOn(
  dispatcher: Dispatcher,
  server: MemorySocket,
  client: MemorySocket,
  options: Omit<WebSocketOptions, "log"> = {},
): WsRun {
  const frames: unknown[] = [];
  const closes: number[] = [];
  const logs: string[] = [];
  client.addEventListener("message", (event: { data: unknown }) => frames.push(event.data));
  client.addEventListener("close", (event: { code: number }) => closes.push(event.code));
  let finished = false;
  const done = webSocketTransport(dispatcher, server, { ...options, log: (line) => logs.push(line) }).then(() => {
    finished = true;
  });
  const messages = () =>
    frames.map((frame) => {
      assert.equal(typeof frame, "string");
      return decode(frame as string) as unknown as ServerMessage;
    });
  const send = (message: unknown) => client.send(typeof message === "string" ? message : JSON.stringify(message));
  const responseTo = (id: number) => messages().find((message) => !("method" in message) && message.id === id);
  return {
    server,
    client,
    frames,
    messages,
    logs,
    closes,
    done,
    finished: () => finished,
    send,
    async request(id, method, params) {
      send({ jsonrpc: "2.0", id, method, params });
      await until(() => responseTo(id) !== undefined, `the response to ${id}`);
      return responseTo(id) as ServerMessage;
    },
  };
}

export const initParams = { clientInfo: { name: "ws", version: "0" }, capabilities: [] };

export const methodsOf = (messages: readonly ServerMessage[]) =>
  messages.flatMap((message) => ("method" in message ? [message.method] : []));
