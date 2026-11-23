// The service worker's logic, kept apart from the worker's global scope so tests can run it against a fake cache and
// fetch (ADR 0059). src/offline/sw.ts wires it to the worker's events, and scripts/offline-build.mjs bundles the two
// into dist/sw.js with this build's file list.
//
// Three rules keep a cache from serving anything the build did not write:
// - Only a same-origin GET whose path is in the build's file list is ever read from or written to a cache. A cache key
//   is the origin and path alone, so a query string or a fragment can never pick a different entry.
// - A response is stored only when it is a 200 of type "basic", not redirected, carries no Set-Cookie, no `Vary: *` and
//   no `no-store` or `private`, and its bytes have the size and SHA-256 the file list records. A response from a newer
//   deploy, an error page or anything an attacker could make the server return fails that check.
// - Each build has its own cache, named by its build id, so a page and its assets read from the cache always come from
//   the same build. A newer worker deletes the older caches only once it has activated.

/** The prefix of every cache this worker owns; caches with other names are never read or deleted. */
export const CACHE_PREFIX = "manual-";

/** How long a page request waits for the network before a saved copy is shown, in milliseconds. */
export const NAVIGATION_TIMEOUT_MS = 3000;

/** The page shown for a page that is not saved, while the network is unreachable. */
export const OFFLINE_PATH = "/offline/";

// The worker script and the build's file list must always come from the network: a cached copy of either could keep
// an old build alive. The build leaves both out of the file list too.
const NEVER_CACHED = new Set(["/sw.js", "/offline-manifest.json"]);

// Files whose names carry a hash of their content: a name always means the same bytes, so a saved copy is used without
// asking the network. Astro hashes everything under /_astro/, and Pagefind names its index chunks and fragments by hash.
const CONTENT_ADDRESSED = [/^\/_astro\//, /^\/pagefind\/index\//, /^\/pagefind\/fragment\//];

/** One file of the build: its size in bytes and the hex SHA-256 of its bytes. */
export interface OfflineFile {
  readonly size: number;
  readonly sha256: string;
}

/** What the build stamps into sw.js: its id, every file a cache may hold by URL path, and the shell to precache. */
export interface OfflineBuild {
  readonly build: string;
  readonly files: Readonly<Record<string, OfflineFile>>;
  readonly shell: readonly string[];
}

/** The part of the Cache API this module uses. */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  keys(): Promise<readonly { readonly url: string }[]>;
}

/** The part of CacheStorage this module uses. */
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/** What the worker needs from its global scope, passed in so tests can replace each one. */
export interface WorkerDeps {
  readonly origin: string;
  readonly caches: CacheStorageLike;
  readonly fetch: (request: Request) => Promise<Response>;
  /** Resolves after `ms` milliseconds; tests resolve it by hand. */
  readonly delay?: (ms: number) => Promise<void>;
}

/** The fields of a fetch event this module reads. `waitUntil` keeps the worker alive for a background write. */
export interface FetchLike {
  readonly request: Request;
  readonly clientId?: string;
  readonly resultingClientId?: string;
  waitUntil?(promise: Promise<unknown>): void;
}

/**
 * The messages a page may send. T67a answers STATUS and SKIP_WAITING; SAVE_ALL and REMOVE_ALL are reserved for the
 * reader's save control (T67b) and answered as unsupported until then.
 */
export type InboundMessage =
  | { readonly type: "STATUS" }
  | { readonly type: "SKIP_WAITING" }
  | { readonly type: "SAVE_ALL" }
  | { readonly type: "REMOVE_ALL" };

/** How much of the build this worker's cache holds. */
export interface StatusReply {
  readonly type: "STATUS";
  readonly build: string;
  readonly total: { readonly files: number; readonly bytes: number };
  readonly saved: { readonly files: number; readonly bytes: number };
  readonly shell: { readonly files: number; readonly saved: number };
}

/** The answer to a message this build's worker does not carry out yet. */
export interface UnsupportedReply {
  readonly type: "UNSUPPORTED";
  readonly request: InboundMessage["type"];
}

/** What handleMessage returns: a reply to post back, a request to skip waiting, or nothing for a malformed message. */
export type MessageOutcome = StatusReply | UnsupportedReply | { readonly type: "SKIP_WAITING" } | null;

const MESSAGE_TYPES = new Set<string>(["STATUS", "SKIP_WAITING", "SAVE_ALL", "REMOVE_ALL"]);

/** Returns the cache name for a build id. */
export function cacheName(build: string): string {
  return `${CACHE_PREFIX}${build}`;
}

/** Returns the lower-case hex SHA-256 of some bytes. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * True when a response may be stored at all, before its bytes are checked: a plain same-origin 200 that sets no cookie
 * and does not forbid storing.
 */
export function storable(response: Response): boolean {
  if (response.status !== 200 || response.type !== "basic" || response.redirected) return false;
  const control = response.headers.get("cache-control") ?? "";
  if (/(^|[\s,])(no-store|private)([\s,=]|$)/i.test(control)) return false;
  if (response.headers.has("set-cookie")) return false;
  return (response.headers.get("vary") ?? "").trim() !== "*";
}

const isContentAddressed = (path: string) => CONTENT_ADDRESSED.some((pattern) => pattern.test(path));

const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The service worker for one build. */
export class OfflineWorker {
  readonly cacheName: string;
  readonly #build: OfflineBuild;
  readonly #files: Map<string, OfflineFile>;
  readonly #deps: WorkerDeps;
  readonly #delay: (ms: number) => Promise<void>;
  // Pages whose document is exactly this build's file, from the cache or checked against the list. Their assets come
  // from this build's cache first, so the page never runs with another build's script or stylesheet. The set lives in
  // memory only; after the browser stops the worker, assets fall back to the network-first rule, which is also safe.
  readonly #buildClients = new Set<string>();

  constructor(build: OfflineBuild, deps: WorkerDeps) {
    this.#build = build;
    this.#files = new Map(
      Object.entries(build.files).filter(([path]) => path.startsWith("/") && !NEVER_CACHED.has(path)),
    );
    this.#deps = deps;
    this.#delay = deps.delay ?? defaultDelay;
    this.cacheName = cacheName(build.build);
  }

  /**
   * Returns the cache key for a URL: its origin and path, or null when the URL is another origin's or the path is not a
   * file of this build.
   */
  keyFor(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.origin !== this.#deps.origin || !this.#files.has(parsed.pathname)) return null;
    return `${parsed.origin}${parsed.pathname}`;
  }

  /** Returns the response if it is storable and its bytes are this build's file at that key; otherwise null. */
  async verified(key: string, response: Response): Promise<Response | null> {
    const file = this.#files.get(new URL(key).pathname);
    if (!file || !storable(response)) return null;
    const copy = response.clone();
    const bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength !== file.size || (await sha256Hex(bytes)) !== file.sha256) return null;
    return copy;
  }

  /** Stores a response under its key if it passes `verified`; returns whether it was stored. */
  async store(key: string, response: Response): Promise<boolean> {
    const copy = await this.verified(key, response);
    if (!copy) return false;
    await (await this.#deps.caches.open(this.cacheName)).put(key, copy);
    return true;
  }

  /**
   * Fills this build's cache at install: first with any file an older build's cache already holds with the same bytes,
   * then with every shell file still missing, from the network. Throws if a shell file cannot be fetched or is not this
   * build's, so the browser discards the new worker and the old one keeps serving.
   */
  async install(): Promise<void> {
    const cache = await this.#deps.caches.open(this.cacheName);
    await this.#carryOver(cache);
    for (const path of this.#build.shell) {
      const key = this.keyFor(`${this.#deps.origin}${path}`);
      if (!key) throw new Error(`the shell names ${path}, which is not a file of this build`);
      if (await cache.match(key)) continue;
      // no-cache revalidates with the server, so an HTTP cache entry from an older deploy is never taken as current.
      const request = new Request(key, { cache: "no-cache", credentials: "same-origin", redirect: "error" });
      const response = await this.#deps.fetch(request);
      if (!(await this.store(key, response))) throw new Error(`${path} is not this build's file`);
    }
  }

  // Copies unchanged files from older builds' caches, so an update keeps the pages a reader already saved.
  async #carryOver(cache: CacheLike): Promise<void> {
    for (const name of await this.#deps.caches.keys()) {
      if (!name.startsWith(CACHE_PREFIX) || name === this.cacheName) continue;
      const older = await this.#deps.caches.open(name);
      for (const request of await older.keys()) {
        const key = this.keyFor(request.url);
        if (!key || (await cache.match(key))) continue;
        const response = await older.match(key);
        if (response) await this.store(key, response);
      }
    }
  }

  /** Deletes every older build's cache. Runs at activate, once this build's cache is complete. */
  async activate(): Promise<void> {
    for (const name of await this.#deps.caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== this.cacheName) await this.#deps.caches.delete(name);
    }
  }

  /**
   * Decides, synchronously as a fetch event requires, whether the worker answers a request. Returns the response's
   * promise, or null to leave the request to the browser: anything but a same-origin GET, a range request, and any
   * subresource that is not a file of this build.
   */
  handleFetch(event: FetchLike): Promise<Response> | null {
    const { request } = event;
    if (request.method !== "GET" || request.headers.has("range")) return null;
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return null;
    }
    if (url.origin !== this.#deps.origin || NEVER_CACHED.has(url.pathname)) return null;
    if (request.mode === "navigate") return this.#navigate(event, this.keyFor(request.url));
    const key = this.keyFor(request.url);
    if (!key) return null;
    const fromBuild = isContentAddressed(url.pathname) || this.#buildClients.has(event.clientId ?? "");
    return fromBuild ? this.#cacheFirst(event, key) : this.#networkFirst(event, key);
  }

  async #cached(key: string): Promise<Response | undefined> {
    return (await this.#deps.caches.open(this.cacheName)).match(key);
  }

  #background(event: FetchLike, work: Promise<unknown>): void {
    const quiet = work.catch(() => undefined);
    event.waitUntil?.(quiet);
  }

  async #cacheFirst(event: FetchLike, key: string): Promise<Response> {
    const cached = await this.#cached(key);
    if (cached) return cached;
    const response = await this.#deps.fetch(event.request);
    // The copy is taken now, before the page starts reading the body.
    this.#background(event, this.store(key, response.clone()));
    return response;
  }

  async #networkFirst(event: FetchLike, key: string): Promise<Response> {
    try {
      const response = await this.#deps.fetch(event.request);
      // The copy is taken now, before the page starts reading the body.
      this.#background(event, this.store(key, response.clone()));
      return response;
    } catch (error) {
      const cached = await this.#cached(key);
      if (cached) return cached;
      throw error;
    }
  }

  // A page: the network's answer, whatever its status, unless the network fails or takes longer than the timeout.
  // Then the saved copy, or the offline page for a page that is not saved. A slow network with nothing saved is waited
  // for, because the offline page would be wrong while the page may still arrive.
  async #navigate(event: FetchLike, key: string | null): Promise<Response> {
    const client = event.resultingClientId ?? "";
    const network = this.#deps.fetch(event.request);
    const settled = network.then(
      (response) => ({ response }),
      () => ({ response: null }),
    );
    // Store the page once it arrives, even after the cache answered, and remember a page that is this build's.
    const saving = network.then(async (response) => {
      const copy = response.clone();
      if (key && (await this.store(key, copy)) && client) this.#buildClients.add(client);
    });
    this.#background(event, saving);
    const first = await Promise.race([settled, this.#delay(NAVIGATION_TIMEOUT_MS).then(() => "timeout" as const)]);
    if (first !== "timeout" && first.response) return first.response;
    const saved = key ? await this.#cached(key) : undefined;
    if (saved) {
      if (client) this.#buildClients.add(client);
      return saved;
    }
    if (first === "timeout") {
      const late = await settled;
      if (late.response) return late.response;
    }
    const offline = await this.#cached(`${this.#deps.origin}${OFFLINE_PATH}`);
    if (offline) {
      if (client) this.#buildClients.add(client);
      return offline;
    }
    return Response.error();
  }

  /** Answers a page's message; anything that is not one of the four message shapes is ignored. */
  async handleMessage(data: unknown): Promise<MessageOutcome> {
    if (typeof data !== "object" || data === null) return null;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) return null;
    const message = { type } as InboundMessage;
    if (message.type === "SKIP_WAITING") return { type: "SKIP_WAITING" };
    if (message.type === "STATUS") return this.status();
    return { type: "UNSUPPORTED", request: message.type };
  }

  /** Counts the files and bytes of this build that its cache holds. */
  async status(): Promise<StatusReply> {
    const cache = await this.#deps.caches.open(this.cacheName);
    const saved = new Set<string>();
    for (const request of await cache.keys()) {
      const key = this.keyFor(request.url);
      if (key) saved.add(new URL(key).pathname);
    }
    let totalBytes = 0;
    let savedBytes = 0;
    for (const [path, file] of this.#files) {
      totalBytes += file.size;
      if (saved.has(path)) savedBytes += file.size;
    }
    return {
      type: "STATUS",
      build: this.#build.build,
      total: { files: this.#files.size, bytes: totalBytes },
      saved: { files: saved.size, bytes: savedBytes },
      shell: { files: this.#build.shell.length, saved: this.#build.shell.filter((path) => saved.has(path)).length },
    };
  }
}
