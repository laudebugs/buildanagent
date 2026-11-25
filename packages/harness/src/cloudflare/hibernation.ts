/**
 * `webSocketHibernation()`: `webSocketTransport()` over a Durable Object's hibernatable WebSockets. With the
 * Hibernation API the runtime delivers a socket's frames to the object's `webSocketMessage()`, `webSocketClose()` and
 * `webSocketError()` methods rather than to listeners, and it may evict the object between two frames while the
 * client stays connected. The bridge turns those calls back into the events the transport reads, one transport per
 * socket.
 *
 * Eviction loses everything in memory, the dispatcher's connections included, so the bridge keeps what a connection
 * needs to carry on in the socket's attachment, which survives hibernation: the client's `initialize` and the sessions
 * it opened or created, never a frame's other content. When a frame arrives on a socket the object no longer serves,
 * the bridge starts a new transport and, before that frame, replays the `initialize` and each `session/open` (or
 * `session/create`, for a session with no entries yet) under ids of its own, whose answers it drops. The client sees
 * none of it and its next command works as before.
 */
import type { ClientMessage, ServerMessage } from "@buildanagent/protocol";
import type { Connection, ConnectOptions, Dispatcher } from "../server/dispatcher.js";
import type { Deliver } from "../server/outbox.js";
import {
  type WebSocketCloseEvent,
  type WebSocketLike,
  type WebSocketMessageEvent,
  type WebSocketOptions,
  webSocketTransport,
} from "../server/websocket.js";

/** A server-side WebSocket that the object accepted with `ctx.acceptWebSocket()`. */
export interface HibernatableWebSocketLike {
  /** 1 while the socket is open; 2 and 3 once it is closing or closed. */
  readonly readyState: number;
  /** The bytes sent but not yet handed to the network, when the runtime reports them. */
  readonly bufferedAmount?: number;
  /** Sends one text frame. */
  send(data: string): void;
  /** Closes the socket, with a status code and a short reason when given. */
  close(code?: number, reason?: string): void;
  /** Keeps a structured-clone copy of `value` with the socket, through hibernation, until the socket closes. */
  serializeAttachment(value: unknown): void;
  /** The last value passed to `serializeAttachment()`, or `null`. */
  deserializeAttachment(): unknown;
}

/** The options of `webSocketHibernation()`. */
export interface WebSocketHibernationOptions {
  /** The object's dispatcher, which every socket's transport connects to. */
  readonly dispatcher: Dispatcher;
  /** The transport's options for every socket, except `signal`: a socket's transport stops when the socket closes. */
  readonly transport?: Omit<WebSocketOptions, "signal">;
}

/** The methods a Durable Object forwards its hibernatable WebSocket events to. */
export interface WebSocketHibernation {
  /** Serves a socket the object has just accepted with `ctx.acceptWebSocket()`. */
  accept(socket: HibernatableWebSocketLike): void;
  /** Call from the object's `webSocketMessage(ws, message)`. Resolves once the frame is handed to the transport. */
  webSocketMessage(socket: HibernatableWebSocketLike, message: string | ArrayBuffer): Promise<void>;
  /** Call from the object's `webSocketClose(ws, code, reason, wasClean)`. It answers the peer's close frame. */
  webSocketClose(socket: HibernatableWebSocketLike, code: number): Promise<void>;
  /** Call from the object's `webSocketError(ws, error)`. */
  webSocketError(socket: HibernatableWebSocketLike): Promise<void>;
  /** How many sockets the bridge serves in memory now: after an eviction, zero until a frame arrives. */
  served(): number;
}

/** The connection state an attachment carries through hibernation. */
interface Attached {
  readonly v: 1;
  initialize?: {
    readonly clientInfo: { readonly name: string; readonly version: string };
    readonly capabilities: string[];
  };
  sessions: { readonly session: string; readonly cwd: string }[];
}

/** Bounds that keep an attachment far below Cloudflare's 16 KiB: at most 8 sessions, and short strings only. */
const MAX_SESSIONS = 8;
const MAX_TEXT = 512;
const MAX_CAPABILITIES = 32;
const RESTORE_ID = "$/hibernation/restore/";

const isText = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_TEXT;

/** The attachment as the bridge wrote it, or an empty state for anything else, so a foreign value is never trusted. */
function attachedOf(value: unknown): Attached {
  const empty: Attached = { v: 1, sessions: [] };
  if (typeof value !== "object" || value === null || (value as { v?: unknown }).v !== 1) return empty;
  const { initialize, sessions } = value as { initialize?: unknown; sessions?: unknown };
  const state: Attached = { v: 1, sessions: [] };
  if (Array.isArray(sessions)) {
    for (const item of sessions.slice(0, MAX_SESSIONS)) {
      const { session, cwd } = (item ?? {}) as { session?: unknown; cwd?: unknown };
      if (isText(session) && isText(cwd)) state.sessions.push({ session, cwd });
    }
  }
  const init = (initialize ?? {}) as { clientInfo?: { name?: unknown; version?: unknown }; capabilities?: unknown };
  const caps = init.capabilities;
  if (isText(init.clientInfo?.name) && isText(init.clientInfo?.version) && Array.isArray(caps) && caps.every(isText)) {
    state.initialize = {
      clientInfo: { name: init.clientInfo.name, version: init.clientInfo.version },
      capabilities: caps.slice(0, MAX_CAPABILITIES),
    };
  }
  return state;
}

/** The socket as `webSocketTransport()` reads it, fed by the object's event methods instead of listeners. */
class BridgedSocket implements WebSocketLike {
  readonly #socket: HibernatableWebSocketLike;
  readonly #listeners = {
    message: new Set<(e: WebSocketMessageEvent) => void>(),
    close: new Set<(e: WebSocketCloseEvent) => void>(),
    error: new Set<(e: unknown) => void>(),
  };

  constructor(socket: HibernatableWebSocketLike) {
    this.#socket = socket;
  }

  get readyState(): number {
    return this.#socket.readyState;
  }

  // A socket without the count is taken never to be full, as the transport takes one without the property.
  get bufferedAmount(): number {
    return this.#socket.bufferedAmount ?? 0;
  }

  send(data: string): void {
    this.#socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }

  addEventListener(type: "message" | "close" | "error", listener: (event: never) => void): void {
    (this.#listeners[type] as Set<(event: never) => void>).add(listener);
  }

  removeEventListener(type: "message" | "close" | "error", listener: (event: never) => void): void {
    (this.#listeners[type] as Set<(event: never) => void>).delete(listener);
  }

  emit(type: "message", event: WebSocketMessageEvent): void;
  emit(type: "close", event: WebSocketCloseEvent): void;
  emit(type: "error", event: unknown): void;
  emit(type: "message" | "close" | "error", event: unknown): void {
    for (const listener of [...this.#listeners[type]]) (listener as (event: unknown) => void)(event);
  }
}

/** Records, in the socket's attachment, the `initialize` and the sessions a connection opened, from their answers. */
class Recorder {
  readonly #socket: HibernatableWebSocketLike;
  readonly #state: Attached;
  readonly #asked = new Map<unknown, (result: unknown) => void>();

  constructor(socket: HibernatableWebSocketLike, state: Attached) {
    this.#socket = socket;
    this.#state = state;
  }

  /** Notes a client command whose answer changes the state, to record once it succeeds. */
  sent(message: ClientMessage): void {
    if (!("id" in message) || !("method" in message)) return;
    const { method, params } = message as { method: string; params?: Record<string, unknown> };
    if (method === "initialize") {
      this.#asked.set(message.id, () => this.#initialized(params));
    } else if (method === "session/open" || method === "session/create") {
      const cwd = params?.cwd;
      this.#asked.set(message.id, (result) => this.#opened((result as { session?: unknown })?.session, cwd));
    }
  }

  /** Records the state a successful answer confirms. */
  answered(message: ServerMessage): void {
    if (!("id" in message) || "method" in message) return;
    const record = this.#asked.get(message.id);
    if (record === undefined) return;
    this.#asked.delete(message.id);
    if ("result" in message) record(message.result);
  }

  #initialized(params: Record<string, unknown> | undefined): void {
    const next = attachedOf({ v: 1, initialize: params, sessions: [] }).initialize;
    if (next === undefined) return;
    this.#state.initialize = next;
    this.#save();
  }

  #opened(session: unknown, cwd: unknown): void {
    if (!isText(session) || !isText(cwd)) return;
    const others = this.#state.sessions.filter((item) => item.session !== session);
    this.#state.sessions = [...others, { session, cwd }].slice(-MAX_SESSIONS);
    this.#save();
  }

  #save(): void {
    try {
      this.#socket.serializeAttachment(this.#state);
    } catch {
      // A socket that can't keep the state still works until the object is evicted.
    }
  }
}

/** A dispatcher whose connections record their state and, after an eviction, replay it before the client's frames. */
function recordingDispatcher(inner: Dispatcher, socket: HibernatableWebSocketLike, restoring: boolean): Dispatcher {
  const state = attachedOf(socket.deserializeAttachment());
  const recorder = new Recorder(socket, state);
  return {
    close: () => inner.close(),
    connect(send: Deliver, options?: ConnectOptions): Connection {
      const replies = new Map<string, (message: ServerMessage) => void>();
      const connection = inner.connect((message) => {
        const id = (message as { id?: unknown }).id;
        const reply = typeof id === "string" && !("method" in message) ? replies.get(id) : undefined;
        if (reply !== undefined) {
          replies.delete(id as string);
          reply(message);
          return undefined;
        }
        recorder.answered(message);
        return send(message);
      }, options);
      const ready = restoring ? replay(connection, replies, state) : undefined;
      return {
        close: () => connection.close(),
        async receive(message) {
          if (ready !== undefined) await ready;
          recorder.sent(message);
          return connection.receive(message);
        },
      };
    },
  };
}

/** Sends the recorded `initialize` and opens, each under an id of the bridge's, and waits for each answer. */
async function replay(
  connection: Connection,
  replies: Map<string, (message: ServerMessage) => void>,
  state: Attached,
): Promise<void> {
  let count = 0;
  const ask = async (method: string, params: unknown): Promise<boolean> => {
    const id = `${RESTORE_ID}${count++}`;
    const answered = new Promise<ServerMessage>((resolve) => replies.set(id, resolve));
    await connection.receive({ jsonrpc: "2.0", id, method, params } as ClientMessage);
    return "result" in (await answered);
  };
  if (state.initialize !== undefined) await ask("initialize", state.initialize);
  for (const { session, cwd } of state.sessions) {
    // A session with no entries yet was only in the evicted dispatcher's memory, so it is created again.
    if (!(await ask("session/open", { session, cwd }))) await ask("session/create", { session, cwd });
  }
}

interface Served {
  readonly bridged: BridgedSocket;
}

/** The close code to answer a peer's close frame with: its own when an application may send it, else none. */
function answerCode(code: number): number | undefined {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : undefined;
}

/**
 * Serves the protocol over a Durable Object's hibernatable WebSockets. Build it in the object's constructor with the
 * object's dispatcher, call `accept()` after `ctx.acceptWebSocket()`, and forward the object's `webSocketMessage()`,
 * `webSocketClose()` and `webSocketError()` to it. Each socket gets its own `webSocketTransport()`, with the same
 * frame rules, bounds and close codes as anywhere else. The transport authenticates nobody: check the peer before
 * accepting its socket.
 *
 * The bridge records the client's `initialize` and up to 8 opened sessions in each socket's attachment, and after an
 * eviction replays them, as the module comment describes. A session with no entries is created again with its id and
 * `cwd`. A turn never spans an eviction, because a running turn keeps the object in memory. The transport's
 * backpressure polls `bufferedAmount` on a timer, which also keeps the object in memory while a client reads slowly.
 */
export function webSocketHibernation(options: WebSocketHibernationOptions): WebSocketHibernation {
  const served = new Map<HibernatableWebSocketLike, Served>();
  const serve = (socket: HibernatableWebSocketLike, restoring: boolean): Served | undefined => {
    const existing = served.get(socket);
    if (existing !== undefined) return existing;
    if (socket.readyState !== 1) return undefined;
    const bridged = new BridgedSocket(socket);
    const entry: Served = { bridged };
    served.set(socket, entry);
    const dispatcher = recordingDispatcher(options.dispatcher, socket, restoring);
    void webSocketTransport(dispatcher, bridged, options.transport).finally(() => {
      if (served.get(socket) === entry) served.delete(socket);
    });
    return entry;
  };
  return {
    accept(socket) {
      serve(socket, false);
    },
    async webSocketMessage(socket, message) {
      serve(socket, true)?.bridged.emit("message", { data: message });
    },
    async webSocketClose(socket, code) {
      served.get(socket)?.bridged.emit("close", { code });
      served.delete(socket);
      const answer = answerCode(code);
      try {
        if (answer === undefined) socket.close();
        else socket.close(answer);
      } catch {
        // The outgoing side is already closed.
      }
    },
    async webSocketError(socket) {
      served.get(socket)?.bridged.emit("error", {});
      served.delete(socket);
    },
    served: () => served.size,
  };
}
