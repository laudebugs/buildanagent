/**
 * The in-process transport: a client that lives in the same process as the dispatcher. It takes plain method calls,
 * sends them as protocol messages and hands back the results, so a CLI or a test drives the harness with no framing,
 * and the stdio transport later carries the same messages.
 */
import type {
  ClientCommand,
  ClientResultMap,
  RpcError,
  ServerMessage,
  ServerRequest,
  ServerResultMap,
} from "@buildanagent/protocol";
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

/** What `InProcessClient.request()` takes besides the method and its params. */
export interface RequestOptions {
  /**
   * Cancels the request with `$/cancelRequest` when it aborts. For an accepted `turn/start` that lasts until the turn's
   * `turn/settled`, so aborting after the disposition still aborts the turn.
   */
  readonly signal?: AbortSignal;
}

/** What a client sees: calls that resolve with a result, the server's messages, and a way to answer its requests. */
export interface InProcessClient {
  /** Sends one command and resolves with its result. Rejects with an `RpcFailure` when the server answers an error. */
  request<M extends Methods>(method: M, params: ParamsOf<M>, options?: RequestOptions): Promise<ClientResultMap[M]>;
  /** Calls `listener` with every notification and request the server sends, after any response already sent. */
  onMessage(listener: (message: ServerMessage) => void): () => void;
  /**
   * Answers a server request with the result its method takes, so an approval can't be answered with a tool result.
   * An answer to a request the server withdrew is ignored there.
   */
  respond<R extends ServerRequest>(request: R, result: ServerResultMap[R["method"]]): void;
  /** Answers a server request with an error, for a request the client can't or won't answer. */
  fail(request: ServerRequest, error: RpcError): void;
  /** Ends this client's connection. */
  close(): void;
}

/** Sends `$/cancelRequest` for a request when its signal aborts, and returns how to stop listening. */
function cancelling(connection: Connection, closed: () => boolean) {
  return (signal: AbortSignal | undefined, id: number): (() => void) => {
    if (signal === undefined) return () => undefined;
    const cancel = () => {
      if (!closed()) void connection.receive({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });
    };
    signal.addEventListener("abort", cancel, { once: true });
    return () => signal.removeEventListener("abort", cancel);
  };
}

/** Connects a new client to `dispatcher`. */
export function inProcessTransport(dispatcher: Dispatcher): InProcessClient {
  const listeners = new Set<(message: ServerMessage) => void>();
  const waiting = new Map<number | string, { resolve: (value: never) => void; reject: (error: Error) => void }>();
  // The cancel listener of each accepted turn, removed once the turn settles.
  const turns = new Map<string, () => void>();
  let nextId = 1;
  let closed = false;
  const connection: Connection = dispatcher.connect((message) => {
    if (!("method" in message)) {
      if (message.id === null) return;
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      if (pending === undefined) return;
      if ("error" in message) pending.reject(new RpcFailure(message.error));
      else pending.resolve(message.result as never);
      return;
    }
    if (message.method === "turn/settled") {
      turns.get(message.params.turn)?.();
      turns.delete(message.params.turn);
    }
    for (const listener of listeners) listener(message);
  });
  const answer = (id: string, body: { result: unknown } | { error: RpcError }) => {
    if (!closed) void connection.receive({ jsonrpc: "2.0", id, ...body } as never);
  };
  const cancelOn = cancelling(connection, () => closed);
  return {
    request(method, params, options = {}) {
      if (closed) return Promise.reject(new Error("the connection closed"));
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      const id = nextId++;
      const stop = cancelOn(options.signal, id);
      const answered = new Promise<never>((resolve, reject) => waiting.set(id, { resolve, reject }));
      void connection.receive({ jsonrpc: "2.0", id, method, params } as ClientCommand);
      return answered.then(
        (result) => {
          const disposition = result as { accepted?: unknown; turn?: unknown };
          // An accepted turn stays cancellable by this request's id until it settles.
          if (method === "turn/start" && disposition.accepted === true && typeof disposition.turn === "string") {
            turns.set(disposition.turn, stop);
          } else stop();
          return result;
        },
        (error: unknown) => {
          stop();
          throw error;
        },
      );
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    respond(request, result) {
      answer(request.id, { result });
    },
    fail(request, error) {
      answer(request.id, { error });
    },
    close() {
      closed = true;
      connection.close();
      for (const pending of waiting.values()) pending.reject(new Error("the connection closed"));
      waiting.clear();
      for (const stop of turns.values()) stop();
      turns.clear();
    },
  };
}
