// Fakes of the Cache API, fetch and the worker's timer for the offline worker's tests. Node's Response always has the
// type "default", so basic() marks a response as a browser's same-origin "basic" one, and its clones keep the mark.
import { createHash } from "node:crypto";
import { BUILD_PLACEHOLDER, type CacheLike, type CacheStorageLike, type OfflineBuild } from "../src/offline/worker.js";

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
  /** How many times each key was read and written, for the tests that count record accesses. */
  readonly reads = new Map<string, number>();
  readonly writes = new Map<string, number>();
  /** Set to make a put fail as a browser does when it refuses the space; it gets the key and returns the error. */
  refuse: ((key: string) => Error | null) | null = null;
  async match(key: string): Promise<Response | undefined> {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    return this.entries.get(key)?.clone();
  }
  async put(key: string, response: Response): Promise<void> {
    const error = this.refuse?.(key);
    if (error) throw error;
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
    this.entries.set(key, response);
  }
  async delete(key: string): Promise<boolean> {
    return this.entries.delete(key);
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

// As the build does, a page is listed with its build mark holding the placeholder.
const unstamped = (text: string) =>
  text.replace(/(<meta name="manual-build" content=")[A-Za-z0-9_]{1,64}(")/, `$1${BUILD_PLACEHOLDER}$2`);

/** A build whose files have these texts, keyed by URL path; a path ending in a slash is a page. */
export function buildOf(id: string, texts: Record<string, string>, shell: string[]): OfflineBuild {
  return {
    build: id,
    shell,
    files: Object.fromEntries(
      Object.entries(texts).map(([path, text]) => {
        if (!path.endsWith("/")) return [path, { size: Buffer.byteLength(text), sha256: sha(text) }];
        const listed = unstamped(text);
        return [path, { size: Buffer.byteLength(listed), sha256: sha(listed), html: true }];
      }),
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
