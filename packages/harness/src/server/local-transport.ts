/**
 * The in-process transport: a client that lives in the same process as the dispatcher. It takes plain method calls,
 * sends them as protocol messages and hands back the results, so a CLI or a test drives the harness with no framing,
 * and the stdio transport later carries the same messages.
 */
import type { ClientCommand, ClientResultMap, RpcError, ServerMessage } from "@buildanagent/protocol";
import type { Connection, Dispatcher } from "./dispatcher.js";

type Methods = ClientCommand["method"] & keyof ClientResultMap;
type ParamsOf<M extends Methods> = ClientCommand extends infer C
  ? C extends { method: infer X; params: infer P }
    ? M extends X
      ? P
      : never
    : never
  : never;

/** A command the server answered with an error. */
export class RpcFailure extends Error {
  readonly rpc: RpcError;
  constructor(rpc: RpcError) {
    super(rpc.message);
    this.name = "RpcFailure";
    this.rpc = rpc;
  }
}

/** What a client sees: calls that resolve with a result, and the server's notifications. */
export interface InProcessClient {
  /** Sends one command and resolves with its result. Rejects with an `RpcFailure` when the server answers an error. */
  request<M extends Methods>(method: M, params: ParamsOf<M>): Promise<ClientResultMap[M]>;
  /** Calls `listener` with every notification and request the server sends, after any response already sent. */
  onMessage(listener: (message: ServerMessage) => void): () => void;
  /** Ends this client's connection. */
  close(): void;
}

/** Connects a new client to `dispatcher`. */
export function inProcessTransport(dispatcher: Dispatcher): InProcessClient {
  const listeners = new Set<(message: ServerMessage) => void>();
  const waiting = new Map<number | string, { resolve: (value: never) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let closed = false;
  const connection: Connection = dispatcher.connect((message) => {
    if ("id" in message && message.id !== null && ("result" in message || "error" in message)) {
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      if (pending === undefined) return;
      if ("error" in message) pending.reject(new RpcFailure(message.error));
      else pending.resolve(message.result as never);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return {
    request(method, params) {
      if (closed) return Promise.reject(new Error("the connection closed"));
      const id = nextId++;
      const answer = new Promise<never>((resolve, reject) => waiting.set(id, { resolve, reject }));
      void connection.receive({ jsonrpc: "2.0", id, method, params } as ClientCommand);
      return answer;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      connection.close();
      for (const pending of waiting.values()) pending.reject(new Error("the connection closed"));
      waiting.clear();
    },
  };
}
