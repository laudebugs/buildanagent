// The service worker's logic, kept apart from the worker's global scope so tests can run it against a fake cache and
// fetch (ADR 0059). src/offline/sw.ts wires it to the worker's events, and scripts/offline-build.mjs bundles the two
// into dist/sw.js with this build's file list.
//
// Four rules keep a cache from serving anything the build did not write:
// - Only a same-origin GET whose normalised path is in the build's file list is ever read from or written to a cache.
//   A cache key is the origin and that path alone, so a query string, a fragment, a doubled slash or a percent-encoded
//   name can never pick a different entry.
// - A response is stored only when it is a 200 of type "basic", not redirected, carries no Set-Cookie, no `Vary: *` and
//   no `no-store` or `private`, and its bytes have the size and SHA-256 the file list records. A page whose bytes a CDN
//   rewrote (an injected script, an obfuscated email address) is stored only when it still carries this build's
//   `<meta name="manual-build">`, and the worker reports it as rewritten.
// - Each build has its own cache, named by its build id. A page served from that cache, or checked against the list,
//   gets its assets from the same cache, or from the network only when the network's bytes are this build's; the
//   worker records such pages in the cache itself, so the rule holds after the browser restarts the worker.
// - Every file the worker could not store when it tried to save it is recorded, and STATUS reports it.

import { BUILD_PLACEHOLDER, findMark, withMark } from "./mark.js";

export { BUILD_PLACEHOLDER, findMark, withMark };

/** The prefix of every cache this worker owns; caches with other names are never read or deleted. */
export const CACHE_PREFIX = "manual-";

/** How long a page request waits for the network before a saved copy is shown, in milliseconds. */
export const NAVIGATION_TIMEOUT_MS = 3000;

/** The page shown for a page that is not saved, while the network is unreachable. */
export const OFFLINE_PATH = "/offline/";

/** The most paths one SAVE_PAGE message may ask for. */
export const SAVE_PAGE_LIMIT = 100;

// Two records the worker keeps in its own cache, under paths no file of the book has and keyFor never returns, so a
// request can never be answered with either.
const RECORD_PREFIX = "/__manual-offline__/";
const CLIENTS_RECORD = `${RECORD_PREFIX}clients.json`;
const PROBLEMS_RECORD = `${RECORD_PREFIX}problems.json`;
const OLDER_RECORD = `${RECORD_PREFIX}older.json`;
// Written when a worker starts to install into its cache and cleared when it activates. A build's cache can be another
// worker's older cache and a waiting worker's own at once, when a deploy brings back a build whose id is the same, so
// no worker deletes a cache whose own worker is installing or waiting. A mark older than a day is from a worker that
// never activated, and no longer protects its cache.
const PENDING_RECORD = `${RECORD_PREFIX}pending.json`;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
// Pages kept in the clients record; the oldest go first, since a page that long ago has closed.
const MAX_CLIENTS = 200;

// The worker script and the build's file list must always come from the network: a cached copy of either could keep
// an old build alive. The build leaves both out of the file list too.
const NEVER_CACHED = new Set(["/sw.js", "/offline-manifest.json"]);

// Files whose names carry a hash of their content: a name always means the same bytes, so a saved copy is used without
// asking the network. Astro hashes everything under /_astro/, and Pagefind names its index chunks and fragments by hash.
const CONTENT_ADDRESSED = [/^\/_astro\//, /^\/pagefind\/index\//, /^\/pagefind\/fragment\//];

/** One file of the build: its size in bytes, the hex SHA-256 of its bytes, and whether it is a page. */
export interface OfflineFile {
  readonly size: number;
  readonly sha256: string;
  readonly html?: boolean;
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
  /** The ids of the pages and workers open now (`clients.matchAll()`); without it, no page counts as open. */
  readonly openClients?: () => Promise<readonly string[]>;
  /** The time in milliseconds; tests pass a fixed clock. */
  readonly now?: () => number;
}

/** The fields of a fetch event this module reads. `waitUntil` keeps the worker alive for a background write. */
export interface FetchLike {
  readonly request: Request;
  readonly clientId?: string;
  readonly resultingClientId?: string;
  waitUntil?(promise: Promise<unknown>): void;
}

/**
 * The messages a page may send. STATUS, SKIP_WAITING and SAVE_PAGE work now; SAVE_ALL and REMOVE_ALL are reserved for
 * the reader's save control (T67b) and answered as unsupported until then.
 */
export type InboundMessage =
  | { readonly type: "STATUS" }
  | { readonly type: "SKIP_WAITING" }
  | { readonly type: "SAVE_PAGE"; readonly paths: readonly string[] }
  | { readonly type: "SAVE_ALL" }
  | { readonly type: "REMOVE_ALL" };

/** A file the worker tried to save and could not, with the reason. */
export interface Problem {
  readonly path: string;
  readonly reason: "different-bytes" | "no-build-mark" | "not-storable" | "network";
}

/** How much of the build this worker's cache holds, and what it could not save. */
export interface StatusReply {
  readonly type: "STATUS";
  readonly build: string;
  readonly total: { readonly files: number; readonly bytes: number };
  readonly saved: { readonly files: number; readonly bytes: number };
  readonly shell: { readonly files: number; readonly saved: number };
  /** Pages stored although a CDN changed their bytes, because they still carry this build's mark. */
  readonly rewritten: readonly string[];
  readonly failed: readonly Problem[];
}

/** The answer to SAVE_PAGE: the paths saved now or already saved, and the problems. */
export interface SavedReply {
  readonly type: "SAVED";
  readonly saved: readonly string[];
  readonly failed: readonly Problem[];
}

/** The answer to a message this build's worker does not carry out yet. */
export interface UnsupportedReply {
  readonly type: "UNSUPPORTED";
  readonly request: InboundMessage["type"];
}

/** What handleMessage returns: a reply to post back, a request to skip waiting, or nothing for a malformed message. */
export type MessageOutcome = StatusReply | SavedReply | UnsupportedReply | { readonly type: "SKIP_WAITING" } | null;

const MESSAGE_TYPES = new Set<string>(["STATUS", "SKIP_WAITING", "SAVE_PAGE", "SAVE_ALL", "REMOVE_ALL"]);

/** Returns the cache name for a build id. */
export function cacheName(build: string): string {
  return `${CACHE_PREFIX}${build}`;
}

/** Returns the `<meta>` tag the build writes into every page; the worker checks a rewritten page for it. */
export function buildMark(build: string): string {
  return `<meta name="manual-build" content="${build}">`;
}

/** Returns the lower-case hex SHA-256 of some bytes. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns the path a same-origin URL names, decoded segment by segment, with empty segments dropped, or null when a
 * segment does not decode, decodes to a separator or a control character, or is `.` or `..` once decoded. The URL
 * parser has already resolved literal dot segments.
 */
export function normalisePath(pathname: string): string | null {
  const trailing = pathname.endsWith("/");
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    if (raw === "") continue;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "." || segment === ".." || /[/\\]|\p{Cc}/u.test(segment)) return null;
    segments.push(segment);
  }
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}${trailing ? "/" : ""}`;
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

// A page a CDN rewrote is still taken for this build's page if it carries the build's mark and has not grown past this
// many bytes beyond the listed size; an injected script tag or an obfuscated address adds a few hundred bytes.
const REWRITE_ALLOWANCE = 64 * 1024;

type Checked =
  | { readonly ok: true; readonly copy: Response; readonly rewritten: boolean }
  | { readonly ok: false; readonly reason: Problem["reason"] | "other-build" };

/** The service worker for one build. */
export class OfflineWorker {
  readonly cacheName: string;
  readonly #build: OfflineBuild;
  readonly #files: Map<string, OfflineFile>;
  readonly #deps: WorkerDeps;
  readonly #delay: (ms: number) => Promise<void>;
  // Pages whose document is exactly this build's, kept in memory and in the clients record, so the rule survives the
  // browser stopping and restarting the worker.
  readonly #buildClients = new Set<string>();
  #clientsLoaded: Promise<void> | null = null;
  // The problems record, read from the cache once and then kept in memory, so a store reads nothing and writes only
  // when a path's state changes.
  #problems: Promise<Map<string, string>> | null = null;
  // Pages still open on an older build whose cache activate kept, by client id, with that cache's name.
  #olderClients = new Map<string, string>();
  // Read once when the worker starts, so the map survives a restart; until it has been read, a request from a page
  // is answered asynchronously.
  #olderLoaded = false;
  readonly #olderLoad: Promise<void>;
  #records: Promise<unknown> = Promise.resolve();

  constructor(build: OfflineBuild, deps: WorkerDeps) {
    this.#build = build;
    this.#files = new Map(
      Object.entries(build.files).filter(([path]) => normalisePath(path) === path && !NEVER_CACHED.has(path)),
    );
    this.#deps = deps;
    this.#delay = deps.delay ?? defaultDelay;
    this.cacheName = cacheName(build.build);
    this.#olderLoad = this.#loadOlder()
      .catch(() => undefined)
      .finally(() => {
        this.#olderLoaded = true;
      });
  }

  async #loadOlder(): Promise<void> {
    // Opening a cache creates it, so a worker that never installed reads nothing.
    const names = await this.#deps.caches.keys().catch(() => [] as string[]);
    if (!names.includes(this.cacheName)) return;
    const record = await this.#read<unknown>(OLDER_RECORD, {}).catch(() => ({}));
    if (!record || typeof record !== "object" || Array.isArray(record)) return;
    for (const [id, name] of Object.entries(record)) {
      if (typeof name === "string" && name.startsWith(CACHE_PREFIX) && names.includes(name)) {
        this.#olderClients.set(id, name);
      }
    }
  }

  #path(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.origin !== this.#deps.origin) return null;
    return normalisePath(parsed.pathname);
  }

  /**
   * Returns the cache key for a URL: its origin and normalised path, or null when the URL is another origin's or the
   * path is not a file of this build.
   */
  keyFor(url: string): string | null {
    const path = this.#path(url);
    return path !== null && this.#files.has(path) ? `${this.#deps.origin}${path}` : null;
  }

  /**
   * Checks a response against this build's file at `key`. A page is compared with its build mark set back to the
   * placeholder, because the list hashes pages that way, so a page of any build whose content equals this build's page
   * passes; the copy returned then carries this build's mark, so a cache only ever holds this build's exact page. A
   * page a CDN rewrote passes only while it carries this build's mark, and is kept as it arrived.
   */
  async #check(key: string, response: Response): Promise<Checked> {
    const file = this.#files.get(new URL(key).pathname);
    if (!file || !storable(response)) return { ok: false, reason: "not-storable" };
    const copy = response.clone();
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    if (!file.html) {
      if (bytes.byteLength === file.size && (await sha256Hex(bytes)) === file.sha256)
        return { ok: true, copy, rewritten: false };
      return { ok: false, reason: "different-bytes" };
    }
    const mark = findMark(bytes);
    const normalised = withMark(bytes, BUILD_PLACEHOLDER);
    if (normalised.byteLength === file.size && (await sha256Hex(normalised)) === file.sha256) {
      if (mark?.value === this.#build.build) return { ok: true, copy, rewritten: false };
      const restamped = withMark(bytes, this.#build.build);
      const headers = new Headers(response.headers);
      return { ok: true, copy: new Response(restamped as BodyInit, { status: 200, headers }), rewritten: false };
    }
    if (normalised.byteLength > file.size + REWRITE_ALLOWANCE) return { ok: false, reason: "different-bytes" };
    if (mark?.value === this.#build.build) return { ok: true, copy, rewritten: true };
    // Another build's mark means a newer or older deploy answered, which is no fault of this build's.
    return { ok: false, reason: mark ? "other-build" : "no-build-mark" };
  }

  /** Returns the response if it is this build's file at that key, and null otherwise. */
  async verified(key: string, response: Response): Promise<Response | null> {
    const checked = await this.#check(key, response);
    return checked.ok ? checked.copy : null;
  }

  /**
   * Stores a response under its key if it is this build's file. With `report`, a failure is recorded for STATUS; a
   * response from another build is never a failure. Returns whether it was stored.
   */
  async store(key: string, response: Response, report = false): Promise<boolean> {
    const path = new URL(key).pathname;
    const checked = await this.#check(key, response);
    if (!checked.ok) {
      if (report && checked.reason !== "other-build") await this.#problem(path, checked.reason);
      return false;
    }
    await (await this.#cache()).put(key, checked.copy);
    await this.#problem(path, checked.rewritten ? "rewritten" : null);
    return true;
  }

  #cache(): Promise<CacheLike> {
    return this.#deps.caches.open(this.cacheName);
  }

  // Reads a JSON record from this build's cache.
  async #read<T>(path: string, empty: T): Promise<T> {
    const response = await (await this.#cache()).match(`${this.#deps.origin}${path}`);
    if (!response) return empty;
    try {
      return (await response.json()) as T;
    } catch {
      return empty;
    }
  }

  // Writes a JSON record to this build's cache, one write at a time; `value` is read when the write runs, so the
  // last write always holds the latest state.
  #write(path: string, value: () => unknown): Promise<void> {
    const next = this.#records.then(async () => {
      await (await this.#cache()).put(
        `${this.#deps.origin}${path}`,
        new Response(JSON.stringify(value()), { headers: { "content-type": "application/json" } }),
      );
    });
    this.#records = next.catch(() => undefined);
    return next;
  }

  #loadProblems(): Promise<Map<string, string>> {
    this.#problems ??= this.#read<Record<string, string>>(PROBLEMS_RECORD, {}).then(
      (record) =>
        new Map(
          Object.entries(record && typeof record === "object" ? record : {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
    );
    return this.#problems;
  }

  // Records a path's state: a problem, "rewritten", or null to clear it. A state that is already recorded writes
  // nothing, so a store of a file with no problem costs no cache access once the record is loaded.
  async #problem(path: string, state: Problem["reason"] | "rewritten" | null): Promise<void> {
    const record = await this.#loadProblems();
    if ((record.get(path) ?? null) === state) return;
    if (state === null) record.delete(path);
    else record.set(path, state);
    await this.#write(PROBLEMS_RECORD, () => Object.fromEntries(record));
  }

  #loadClients(): Promise<void> {
    this.#clientsLoaded ??= this.#read<unknown>(CLIENTS_RECORD, []).then((ids) => {
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") this.#buildClients.add(id);
    });
    return this.#clientsLoaded;
  }

  async #markBuildClient(client: string): Promise<void> {
    if (!client) return;
    await this.#loadClients();
    if (this.#buildClients.has(client)) return;
    this.#buildClients.add(client);
    // A Set keeps insertion order, so the oldest pages are the first to go.
    while (this.#buildClients.size > MAX_CLIENTS)
      this.#buildClients.delete(this.#buildClients.values().next().value ?? "");
    await this.#write(CLIENTS_RECORD, () => [...this.#buildClients]);
  }

  async #isBuildClient(client: string | undefined): Promise<boolean> {
    if (!client) return false;
    await this.#loadClients();
    return this.#buildClients.has(client);
  }

  /**
   * Fills this build's cache at install: first with any file an older build's cache already holds with the same bytes,
   * then with every shell file still missing, from the network. Throws if a shell file cannot be fetched or is not this
   * build's, so the browser discards the new worker and the old one keeps serving. A shell page a CDN rewrote but that
   * still carries this build's mark is stored and reported as rewritten.
   */
  async install(): Promise<void> {
    const cache = await this.#cache();
    await this.#write(PENDING_RECORD, () => ({ since: this.#now() }));
    await this.#carryOver(cache);
    for (const path of this.#build.shell) {
      const key = this.keyFor(`${this.#deps.origin}${path}`);
      if (!key) throw new Error(`the shell names ${path}, which is not a file of this build`);
      if (await cache.match(key)) continue;
      if (!(await this.#saveFromNetwork(key))) throw new Error(`${path} is not this build's file`);
    }
  }

  // Fetches a listed file, revalidating past the HTTP cache, and stores it if it is this build's; records a failure.
  async #saveFromNetwork(key: string): Promise<boolean> {
    // no-cache revalidates with the server, so an HTTP cache entry from an older deploy is never taken as current.
    const request = new Request(key, { cache: "no-cache", credentials: "same-origin", redirect: "error" });
    let response: Response;
    try {
      response = await this.#deps.fetch(request);
    } catch {
      await this.#problem(new URL(key).pathname, "network");
      return false;
    }
    return this.store(key, response, true);
  }

  // Copies unchanged files from older builds' caches, so an update keeps the pages a reader already saved. Only exact
  // bytes carry over: a rewritten page carries another build's mark.
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

  /**
   * Runs at activate, once this build's cache is complete. Deletes every older build's cache, except one that a page
   * still open was served from: that page keeps its own build's files, which a deploy has removed from the server, and
   * the cache goes at a later activation once no such page is open.
   */
  async activate(): Promise<void> {
    const open = new Set(this.#deps.openClients ? await this.#deps.openClients() : []);
    this.#olderClients = new Map();
    for (const name of await this.#deps.caches.keys()) {
      if (!name.startsWith(CACHE_PREFIX) || name === this.cacheName) continue;
      const response = await (await this.#deps.caches.open(name)).match(`${this.#deps.origin}${CLIENTS_RECORD}`);
      let ids: unknown = [];
      try {
        ids = response ? await response.json() : [];
      } catch {
        ids = [];
      }
      const kept = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && open.has(id)) : [];
      if (kept.length === 0) await this.#deleteUnlessPending(name);
      else for (const id of kept) this.#olderClients.set(id, name);
    }
    this.#olderLoaded = true;
    await this.#write(OLDER_RECORD, () => Object.fromEntries(this.#olderClients));
    await this.#write(PENDING_RECORD, () => ({ since: null }));
  }

  #now(): number {
    return this.#deps.now ? this.#deps.now() : Date.now();
  }

  // Deletes another build's cache unless its own worker is installing or waiting.
  async #deleteUnlessPending(name: string): Promise<void> {
    const response = await (await this.#deps.caches.open(name)).match(`${this.#deps.origin}${PENDING_RECORD}`);
    let since: unknown = null;
    try {
      since = response ? ((await response.json()) as { since?: unknown }).since : null;
    } catch {
      since = null;
    }
    if (typeof since === "number" && this.#now() - since < PENDING_TTL_MS) return;
    await this.#deps.caches.delete(name);
  }

  /**
   * Deletes each older cache that activate kept once none of its pages is open. It touches only the caches activate
   * recorded, never another `manual-` cache, and never a cache whose own worker is installing or waiting, which a
   * deploy that brings an older build back makes possible.
   */
  async pruneOlder(): Promise<void> {
    await this.#olderLoad;
    if (this.#olderClients.size === 0 || !this.#deps.openClients) return;
    const open = new Set(await this.#deps.openClients());
    const live = new Set([...this.#olderClients].filter(([id]) => open.has(id)).map(([, name]) => name));
    let changed = false;
    for (const [id, name] of [...this.#olderClients]) {
      if (open.has(id)) continue;
      this.#olderClients.delete(id);
      changed = true;
      if (!live.has(name) && (await this.#deps.caches.keys()).includes(name)) await this.#deleteUnlessPending(name);
    }
    if (changed) await this.#write(OLDER_RECORD, () => Object.fromEntries(this.#olderClients));
  }

  /**
   * Decides, synchronously as a fetch event requires, whether the worker answers a request. Returns the response's
   * promise, or null to leave the request to the browser: anything but a same-origin GET, a range request, and any
   * subresource that is not a file of this build.
   */
  handleFetch(event: FetchLike): Promise<Response> | null {
    const { request } = event;
    if (request.method !== "GET" || request.headers.has("range")) return null;
    const path = this.#path(request.url);
    if (path === null || NEVER_CACHED.has(path)) return null;
    if (request.mode === "navigate") return this.#navigate(event, path);
    const key = this.keyFor(request.url);
    const client = event.clientId ?? "";
    if (client && !this.#olderLoaded) {
      return this.#olderLoad.then(() => {
        const older = this.#olderClients.get(client);
        if (older) return this.#fromOlder(event, older, path);
        return key ? this.#subresource(event, key, path) : this.#deps.fetch(request);
      });
    }
    const older = this.#olderClients.get(client);
    if (older) return this.#fromOlder(event, older, path);
    if (!key) return null;
    return this.#subresource(event, key, path);
  }

  #subresource(event: FetchLike, key: string, path: string): Promise<Response> {
    if (isContentAddressed(path)) return this.#cacheFirst(event, key, false);
    return this.#isBuildClient(event.clientId).then((pinned) =>
      pinned ? this.#cacheFirst(event, key, true) : this.#networkFirst(event, key),
    );
  }

  // A page still open on an older build gets that build's files from its cache, and anything else from the network.
  async #fromOlder(event: FetchLike, name: string, path: string): Promise<Response> {
    // Opening a cache creates it, so a cache a later activation deleted is never brought back.
    if (!(await this.#deps.caches.keys()).includes(name)) return this.#deps.fetch(event.request);
    const saved = await (await this.#deps.caches.open(name)).match(`${this.#deps.origin}${path}`);
    return saved ?? this.#deps.fetch(event.request);
  }

  async #cached(key: string): Promise<Response | undefined> {
    return (await this.#cache()).match(key);
  }

  #background(event: FetchLike, work: Promise<unknown>): void {
    event.waitUntil?.(work.catch(() => undefined));
  }

  // A saved copy, or the network's. With `strict`, for a page of this build, the network's answer is used only when it
  // is this build's file, so the page never runs another build's script; otherwise the request fails.
  async #cacheFirst(event: FetchLike, key: string, strict: boolean): Promise<Response> {
    const cached = await this.#cached(key);
    if (cached) return cached;
    const response = await this.#deps.fetch(event.request);
    if (!strict) {
      // The copy is taken now, before the page starts reading the body.
      this.#background(event, this.store(key, response.clone()));
      return response;
    }
    const checked = await this.#check(key, response);
    if (!checked.ok) return Response.error();
    this.#background(event, this.store(key, checked.copy.clone()));
    return checked.copy;
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
  async #navigate(event: FetchLike, path: string): Promise<Response> {
    const key = this.keyFor(`${this.#deps.origin}${path}`);
    const client = event.resultingClientId ?? "";
    const network = this.#deps.fetch(event.request);
    const settled = network.then(
      (response) => ({ response }),
      () => ({ response: null }),
    );
    // Store the page once it arrives, even after the cache answered, and remember a page that is this build's.
    const saving = network.then(async (response) => {
      const copy = response.clone();
      if (key && (await this.store(key, copy))) await this.#markBuildClient(client);
    });
    this.#background(event, saving);
    this.#background(event, this.pruneOlder());
    const first = await Promise.race([settled, this.#delay(NAVIGATION_TIMEOUT_MS).then(() => "timeout" as const)]);
    if (first !== "timeout" && first.response) return first.response;
    const saved = key ? await this.#cached(key) : undefined;
    if (saved) {
      this.#background(event, this.#markBuildClient(client));
      return saved;
    }
    if (first === "timeout") {
      const late = await settled;
      if (late.response) return late.response;
    }
    // A directory page asked for without its slash: the server would redirect, so the worker does too.
    if (!key && !path.endsWith("/") && this.#files.has(`${path}/`)) {
      return Response.redirect(`${this.#deps.origin}${path}/${new URL(event.request.url).search}`, 307);
    }
    const offline = await this.#cached(`${this.#deps.origin}${OFFLINE_PATH}`);
    if (offline) {
      this.#background(event, this.#markBuildClient(client));
      return offline;
    }
    return Response.error();
  }

  /** Answers a page's message; anything that is not one of the five message shapes is ignored. */
  async handleMessage(data: unknown): Promise<MessageOutcome> {
    if (typeof data !== "object" || data === null) return null;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) return null;
    if (type === "SKIP_WAITING") return { type: "SKIP_WAITING" };
    if (type === "STATUS") return this.status();
    if (type === "SAVE_PAGE") {
      const paths = (data as { paths?: unknown }).paths;
      if (!Array.isArray(paths) || paths.length > SAVE_PAGE_LIMIT) return null;
      return this.savePage(paths.filter((path): path is string => typeof path === "string"));
    }
    return { type: "UNSUPPORTED", request: type as InboundMessage["type"] };
  }

  /**
   * Saves the listed files among `urls`, same-origin and checked like any other store: the page a reader landed on
   * before the worker controlled it, and the files that page loaded.
   */
  async savePage(urls: readonly string[]): Promise<SavedReply> {
    const cache = await this.#cache();
    const saved: string[] = [];
    const failed: Problem[] = [];
    const keyOf = (url: string) => {
      try {
        return this.keyFor(new URL(url, this.#deps.origin).href);
      } catch {
        return null;
      }
    };
    for (const key of new Set(urls.map(keyOf))) {
      if (!key) continue;
      const path = new URL(key).pathname;
      if ((await cache.match(key)) || (await this.#saveFromNetwork(key))) saved.push(path);
      else {
        const reason = (await this.#loadProblems()).get(path);
        if (reason && reason !== "rewritten") failed.push({ path, reason: reason as Problem["reason"] });
      }
    }
    return { type: "SAVED", saved, failed };
  }

  /** Counts the files and bytes of this build that its cache holds, with the rewritten and failed files. */
  async status(): Promise<StatusReply> {
    await this.pruneOlder().catch(() => undefined);
    const cache = await this.#cache();
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
    const entries = [...(await this.#loadProblems())].filter(([path]) => this.#files.has(path));
    return {
      type: "STATUS",
      build: this.#build.build,
      total: { files: this.#files.size, bytes: totalBytes },
      saved: { files: saved.size, bytes: savedBytes },
      shell: { files: this.#build.shell.length, saved: this.#build.shell.filter((path) => saved.has(path)).length },
      rewritten: entries.filter(([path, state]) => state === "rewritten" && saved.has(path)).map(([path]) => path),
      failed: entries
        .filter(([, state]) => state !== "rewritten")
        .map(([path, reason]) => ({ path, reason: reason as Problem["reason"] })),
    };
  }
}
