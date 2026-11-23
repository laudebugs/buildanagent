// Fakes of the Cache API, fetch and the worker's timer for the offline worker's tests. Node's Response always has the
// type "default", so basic() marks a response as a browser's same-origin "basic" one, and its clones keep the mark.
import { createHash } from "node:crypto";
import type { CacheLike, CacheStorageLike, OfflineBuild } from "../src/offline/worker.js";

export const ORIGIN = "https://manual.buildanagent.fyi";

/** Marks a response, and every clone of it, as a browser's "basic" response. */
export function basic(response: Response): Response {
  const clone = response.clone.bind(response);
  Object.defineProperty(response, "type", { value: "basic" });
  Object.defineProperty(response, "clone", { value: () => basic(clone()) });
  return response;
}

/** A 200 "basic" response with this text and these headers. */
export const ok = (text: string, headers: Record<string, string> = {}) =>
  basic(new Response(text, { status: 200, headers }));

export class FakeCache implements CacheLike {
  readonly entries = new Map<string, Response>();
  async match(key: string): Promise<Response | undefined> {
    return this.entries.get(key)?.clone();
  }
  async put(key: string, response: Response): Promise<void> {
    this.entries.set(key, response);
  }
  async keys(): Promise<readonly { url: string }[]> {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

export class FakeCaches implements CacheStorageLike {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
}

/** A fetch that answers from a table of paths; a path that maps to "offline" rejects, and "hang" never settles. */
export class FakeNetwork {
  readonly requests: Request[] = [];
  readonly table: Record<string, (() => Response) | "offline" | "hang">;
  constructor(table: Record<string, (() => Response) | "offline" | "hang">) {
    this.table = table;
  }
  readonly fetch = (request: Request): Promise<Response> => {
    this.requests.push(request);
    const answer = this.table[new URL(request.url).pathname];
    if (answer === undefined) return Promise.resolve(basic(new Response("not found", { status: 404 })));
    if (answer === "offline") return Promise.reject(new TypeError("Failed to fetch"));
    if (answer === "hang") return new Promise<Response>(() => undefined);
    return Promise.resolve(answer());
  };
}

/** A timer the test fires by hand. */
export class FakeTimer {
  #fire: (() => void) | undefined;
  readonly delay = () =>
    new Promise<void>((resolve) => {
      this.#fire = resolve;
    });
  fire(): void {
    this.#fire?.();
  }
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A build whose files have these texts, keyed by URL path. */
export function buildOf(id: string, texts: Record<string, string>, shell: string[]): OfflineBuild {
  return {
    build: id,
    shell,
    files: Object.fromEntries(
      Object.entries(texts).map(([path, text]) => [path, { size: Buffer.byteLength(text), sha256: sha(text) }]),
    ),
  };
}

/** A request as the browser makes it; `navigate` makes it a page request, which Node's Request cannot construct. */
export function request(path: string, init: RequestInit & { navigate?: boolean } = {}): Request {
  const { navigate, ...rest } = init;
  const req = new Request(path.startsWith("http") ? path : `${ORIGIN}${path}`, rest);
  if (navigate) Object.defineProperty(req, "mode", { value: "navigate" });
  return req;
}
