// An in-memory WebSocket pair for the WebSocket transport's tests: two ends that pass frames to each other in order,
// with a send buffer that grows while the far end does not read, as a real socket's `bufferedAmount` does. Nothing
// here opens a network socket. Frames are handed over on `setImmediate`, so a test that fakes `setTimeout` still sees
// them move.
import type { WebSocketLike } from "@buildanagent/harness/server";

type Kind = "message" | "close" | "error";
type Listener = (event: never) => void;

interface Frame {
  readonly data: unknown;
  readonly bytes: number;
}

const sizeOf = (data: unknown): number => {
  if (typeof data === "string") return new TextEncoder().encode(data).length;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
};

/** One end of the pair. `reading` false holds frames sent to this end in the far end's send buffer. */
export class MemorySocket implements WebSocketLike {
  readyState = 1;
  bufferedAmount = 0;
  /** Every `close()` called on this end, with its code and reason. */
  readonly closeCalls: { code: number | undefined; reason: string | undefined }[] = [];
  /** The largest `bufferedAmount` this end has had. */
  mostBuffered = 0;
  #peer!: MemorySocket;
  readonly #listeners: Record<Kind, Set<Listener>> = { message: new Set(), close: new Set(), error: new Set() };
  readonly #outgoing: Frame[] = [];
  #reading = true;
  #flushing = false;
  #closing: { code: number; reason: string } | undefined;

  static pair(): [server: MemorySocket, client: MemorySocket] {
    const server = new MemorySocket();
    const client = new MemorySocket();
    server.#peer = client;
    client.#peer = server;
    return [server, client];
  }

  addEventListener(type: Kind, listener: Listener): void {
    this.#listeners[type].add(listener);
  }

  removeEventListener(type: Kind, listener: Listener): void {
    this.#listeners[type].delete(listener);
  }

  /** How many listeners this end holds, of every kind. */
  get listenerCount(): number {
    return this.#listeners.message.size + this.#listeners.close.size + this.#listeners.error.size;
  }

  send(data: string | ArrayBuffer | Uint8Array): void {
    if (this.readyState !== 1) throw new Error("InvalidStateError");
    const bytes = sizeOf(data);
    this.#outgoing.push({ data, bytes });
    this.bufferedAmount += bytes;
    this.mostBuffered = Math.max(this.mostBuffered, this.bufferedAmount);
    this.#schedule();
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.#closing = { code: code ?? 1005, reason: reason ?? "" };
    this.#schedule();
  }

  /** Stops or starts reading what the far end sends. */
  set reading(on: boolean) {
    this.#reading = on;
    if (on) this.#peer.#schedule();
  }

  /** Reads one frame the far end has waiting, while not reading otherwise. */
  readOne(): void {
    const frame = this.#peer.#outgoing.shift();
    if (frame === undefined) return;
    this.#peer.bufferedAmount -= frame.bytes;
    this.#emit("message", { data: frame.data });
  }

  /** The socket fails, as a dropped network does: an error, then a close with 1006, on both ends. */
  fail(): void {
    this.#emit("error", { type: "error" });
    this.#peer.#emit("error", { type: "error" });
    this.#finish(1006, "");
  }

  #schedule(): void {
    if (this.#flushing) return;
    this.#flushing = true;
    setImmediate(() => {
      this.#flushing = false;
      this.#flush();
    });
  }

  #flush(): void {
    while (this.#outgoing.length > 0 && this.#peer.#reading && this.#peer.readyState !== 3) {
      const frame = this.#outgoing.shift() as Frame;
      this.bufferedAmount -= frame.bytes;
      this.#peer.#emit("message", { data: frame.data });
    }
    // A close goes after the frames sent before it; a far end that does not read never gets those.
    if (this.#closing !== undefined && (this.#outgoing.length === 0 || !this.#peer.#reading)) {
      this.#finish(this.#closing.code, this.#closing.reason);
    }
  }

  #finish(code: number, reason: string): void {
    for (const end of [this, this.#peer]) {
      if (end.readyState === 3) continue;
      end.readyState = 3;
      end.#outgoing.length = 0;
      end.bufferedAmount = 0;
      end.#emit("close", { code, reason });
    }
  }

  #emit(type: Kind, event: unknown): void {
    for (const listener of [...this.#listeners[type]]) (listener as (event: unknown) => void)(event);
  }
}
