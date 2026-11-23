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
//
// Saving the whole book (SAVE_ALL) downloads only the build's own list, never a URL a page names, and the saved record
// that makes the control say "Saved" is written only once every listed file is in the cache. A save that stops early,
// for a full disk, a dropped connection or a press on Cancel, is recorded as partial, never as saved.

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

/** How many files SAVE_ALL downloads at once. */
export const SAVE_CONCURRENCY = 6;

// Two records the worker keeps in its own cache, under paths no file of the book has and keyFor never returns, so a
// request can never be answered with either.
const RECORD_PREFIX = "/__manual-offline__/";
const CLIENTS_RECORD = `${RECORD_PREFIX}clients.json`;
const PROBLEMS_RECORD = `${RECORD_PREFIX}problems.json`;
const OLDER_RECORD = `${RECORD_PREFIX}older.json`;
// The reader's saved copy: when SAVE_ALL started or finished, for which build, and whether every listed file was stored.
// It lives in the cache it describes, so a browser that evicts the cache evicts the record with it.
const SAVED_RECORD = `${RECORD_PREFIX}saved.json`;
// A complete saved copy of an older build that install carried over, so the control can offer to update it.
const PREVIOUS_RECORD = `${RECORD_PREFIX}previous.json`;
// Written by REMOVE_ALL into every other build's cache: install carries nothing over from such a cache, and the cache's
// own worker purges its saved copy when it activates.
const REMOVED_RECORD = `${RECORD_PREFIX}removed.json`;
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
  delete(key: string): Promise<boolean>;
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
  /** Whether this worker is the registration's active one, when the browser can say; undefined when it cannot. */
  readonly isActive?: () => boolean | undefined;
}

/** The fields of a fetch event this module reads. `waitUntil` keeps the worker alive for a background write. */
export interface FetchLike {
  readonly request: Request;
  readonly clientId?: string;
  readonly resultingClientId?: string;
  waitUntil?(promise: Promise<unknown>): void;
}

/** The messages a page may send. SAVE_ALL takes no paths: it saves the build's own list. */
export type InboundMessage =
  | { readonly type: "STATUS" }
  | { readonly type: "SKIP_WAITING" }
  | { readonly type: "SAVE_PAGE"; readonly paths: readonly string[] }
  | { readonly type: "SAVE_ALL" }
  | { readonly type: "CANCEL_SAVE" }
  | { readonly type: "REMOVE_ALL" };

/**
 * A file the worker tried to save and could not, with the reason. `quota` means the browser refused the space, and
 * `storage` that it refused the write for another reason.
 */
export interface Problem {
  readonly path: string;
  readonly reason: "different-bytes" | "no-build-mark" | "not-storable" | "network" | "quota" | "storage";
}

/** A file SAVE_ALL could not save; `other-build` means the server already holds a newer deploy's file. */
export interface SaveProblem {
  readonly path: string;
  readonly reason: Problem["reason"] | "other-build";
}

/** The reader's complete saved copy: when it was saved, for which build, and how much it holds. */
export interface SavedCopy {
  readonly at: number;
  readonly build: string;
  readonly files: number;
  readonly bytes: number;
}

/** How far a running SAVE_ALL has got: files and bytes stored out of the build's list, and files that failed. */
export interface SaveProgress {
  readonly type: "SAVE_PROGRESS";
  readonly done: number;
  readonly total: number;
  readonly bytes: number;
  readonly failed: number;
}

/**
 * The end of a SAVE_ALL. `saved` holds every listed file; `partial` stopped with files missing, listed in `failed`;
 * `cancelled` stopped at CANCEL_SAVE or REMOVE_ALL; `refused` never started, because this worker is not the active
 * one (`not-active`) or the saved copy is being removed (`busy`). A `partial` save carries `quota` or `storage` when the
 * browser refused a write.
 */
export interface SaveDone {
  readonly type: "SAVE_DONE";
  readonly result: "saved" | "partial" | "cancelled" | "refused";
  readonly reason?: "not-active" | "busy" | "quota" | "storage";
  readonly saved: SavedCopy | null;
  readonly failed: readonly SaveProblem[];
}

/** The answer to REMOVE_ALL: whether the saved copy was removed, which only the active worker does. */
export interface RemovedReply {
  readonly type: "REMOVED";
  readonly removed: boolean;
}

/** How much of the build this worker's cache holds, the reader's saved copy, and what it could not save. */
export interface StatusReply {
  readonly type: "STATUS";
  readonly build: string;
  readonly total: { readonly files: number; readonly bytes: number };
  /** The listed files the cache holds now, however they got there. */
  readonly stored: { readonly files: number; readonly bytes: number };
  readonly shell: { readonly files: number; readonly saved: number };
  /** The complete saved copy, or null when none was saved or a file of it is gone. */
  readonly saved: SavedCopy | null;
  /** A save that started and did not finish, with when it started; null once a save completes or is removed. */
  readonly partial: { readonly at: number } | null;
  /** A complete saved copy of an older build that this build carried over, while this build has none of its own. */
  readonly previous: { readonly at: number; readonly build: string } | null;
  /** The progress of a SAVE_ALL that is running now. */
  readonly saving: Omit<SaveProgress, "type"> | null;
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

/** What handleMessage returns: a reply to post back, a request to skip waiting, or nothing to answer. */
export type MessageOutcome =
  | StatusReply
  | SavedReply
  | SaveDone
  | RemovedReply
  | { readonly type: "SKIP_WAITING" }
  | null;

/** What a message's sender gives handleMessage: where to post progress while a SAVE_ALL runs. */
export interface MessageContext {
  readonly post?: (message: SaveProgress) => void;
}

const MESSAGE_TYPES = new Set<string>(["STATUS", "SKIP_WAITING", "SAVE_PAGE", "SAVE_ALL", "CANCEL_SAVE", "REMOVE_ALL"]);

/** The fields of a message's sender this module reads: a page's tab is a "window" client with a frame type. */
export interface MessageSource {
  readonly type?: string;
  readonly frameType?: string;
  readonly url?: string;
}

/**
 * True when a message comes from a tab or window of `origin`, and false for a frame, a worker or anything else. Only
 * this origin's pages can message the worker; the check keeps that true if a browser ever widens it, and keeps a page
 * of the book that another site frames from starting a download or removing the reader's copy.
 */
export function fromBookWindow(
  origin: string,
  event: { readonly origin: string; readonly source: MessageSource | null },
): boolean {
  const { source } = event;
  if (event.origin !== origin || !source || source.type !== "window") return false;
  if (source.frameType !== "top-level" && source.frameType !== "auxiliary") return false;
  try {
    return new URL(source.url ?? "").origin === origin;
  } catch {
    return false;
  }
}

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
 * and does not forbid storing. With `fromCache`, for a copy read back from one of the worker's own caches, a response
 * the worker built itself also passes: a page it stamped with its build's mark has the type "default".
 */
export function storable(response: Response, fromCache = false): boolean {
  const plain = response.type === "basic" || (fromCache && response.type === "default");
  if (response.status !== 200 || !plain || response.redirected) return false;
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

// One SAVE_ALL while it runs: its counts, the pages to tell, and whether a page asked it to stop.
interface SaveRun {
  done: number;
  total: number;
  bytes: number;
  readonly failed: SaveProblem[];
  readonly listeners: Set<(message: SaveProgress) => void>;
  cancelled: boolean;
  result: Promise<SaveDone>;
}

const isQuotaError = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError";

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
  // Set once activate has run in this instance; after a restart the pending record says whether this worker activated.
  #activated = false;
  #saving: SaveRun | null = null;
  #removing: Promise<RemovedReply> | null = null;

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
  async #check(key: string, response: Response, fromCache = false): Promise<Checked> {
    const file = this.#files.get(new URL(key).pathname);
    if (!file || !storable(response, fromCache)) return { ok: false, reason: "not-storable" };
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
    return (await this.#put(key, response, report)) === null;
  }

  // Stores a checked response and returns null, or returns why it was not stored. A write the browser refuses throws.
  async #put(
    key: string,
    response: Response,
    report: boolean,
    fromCache = false,
  ): Promise<SaveProblem["reason"] | null> {
    const path = new URL(key).pathname;
    const checked = await this.#check(key, response, fromCache);
    if (!checked.ok) {
      if (report && checked.reason !== "other-build") await this.#problem(path, checked.reason);
      return checked.reason;
    }
    await (await this.#cache()).put(key, checked.copy);
    // The file is stored; a full disk that refuses the small problems record does not undo that.
    await this.#problem(path, checked.rewritten ? "rewritten" : null).catch(() => undefined);
    return null;
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
      await (await this.#cache()).put(`${this.#deps.origin}${path}`, jsonResponse(value()));
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
    this.#activated = false;
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
    return (await this.#fetchAndStore(key)) === null;
  }

  // As #saveFromNetwork, returning why the file was not stored. A write the browser refuses throws.
  async #fetchAndStore(key: string): Promise<SaveProblem["reason"] | null> {
    // no-cache revalidates with the server, so an HTTP cache entry from an older deploy is never taken as current.
    const request = new Request(key, { cache: "no-cache", credentials: "same-origin", redirect: "error" });
    let response: Response;
    try {
      response = await this.#deps.fetch(request);
    } catch {
      await this.#problem(new URL(key).pathname, "network").catch(() => undefined);
      return "network";
    }
    return this.#put(key, response, true);
  }

  // Copies unchanged files from older builds' caches, so an update keeps the pages a reader already saved. Only exact
  // bytes carry over: a rewritten page carries another build's mark. An older build's complete saved copy is
  // remembered, so the control can offer to update it.
  async #carryOver(cache: CacheLike): Promise<void> {
    let previous: { at: number; build: string } | null = null;
    for (const name of await this.#deps.caches.keys()) {
      if (!name.startsWith(CACHE_PREFIX) || name === this.cacheName) continue;
      const older = await this.#deps.caches.open(name);
      // The reader removed the saved copy since this cache was filled, so nothing in it is carried back.
      if (await older.match(`${this.#deps.origin}${REMOVED_RECORD}`)) continue;
      const copy = savedRecord(
        await readJson(await older.match(`${this.#deps.origin}${SAVED_RECORD}`)),
        name.slice(CACHE_PREFIX.length),
      );
      // An older build may itself hold a carried-over copy that the reader never updated, after two deploys or more.
      const carried = previousRecord(await readJson(await older.match(`${this.#deps.origin}${PREVIOUS_RECORD}`)));
      for (const found of [copy?.complete ? { at: copy.at, build: copy.build } : null, carried]) {
        if (found && (!previous || found.at > previous.at)) previous = found;
      }
      for (const request of await older.keys()) {
        const key = this.keyFor(request.url);
        if (!key || (await cache.match(key))) continue;
        const response = await older.match(key);
        // A page an older worker stamped with its own mark was built by that worker, so it is a "default" response.
        if (response) await this.#put(key, response, false, true);
      }
    }
    const found = previous;
    if (found) await this.#write(PREVIOUS_RECORD, () => found);
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
    // The reader removed the saved copy while this build waited, after install had carried it over.
    const cache = await this.#cache();
    if (await cache.match(`${this.#deps.origin}${REMOVED_RECORD}`)) await this.#purge(cache);
    await this.#write(OLDER_RECORD, () => Object.fromEntries(this.#olderClients));
    await this.#write(PENDING_RECORD, () => ({ since: null }));
    this.#activated = true;
  }

  // Whether this worker is the registration's active one: it activated in this instance, the browser says so, or its
  // cache exists and holds a cleared pending mark, which install writes and activate clears. Without the browser's word,
  // a worker whose cache the browser evicted has no mark to read, so it refuses until a later activation.
  async #isActive(): Promise<boolean> {
    if (this.#activated) return true;
    const told = this.#deps.isActive?.();
    if (told !== undefined) return told;
    if (!(await this.#cacheExists())) return false;
    const record = await this.#read<{ since?: unknown } | null>(PENDING_RECORD, null);
    return record !== null && typeof record === "object" && record.since === null;
  }

  // Whether this save's cache is still the one it started in. A later worker's activation may delete it, and a file in
  // flight may then write it back, but never with the saved record this save wrote first.
  // It opens the cache by name each time, because a Cache object a save already holds goes on naming the deleted one.
  async #stillSaving(): Promise<boolean> {
    if (!(await this.#cacheExists())) return false;
    return (await (await this.#cache()).match(`${this.#deps.origin}${SAVED_RECORD}`)) !== undefined;
  }

  // Opening a cache creates it, so a save checks first that a later worker's activation has not deleted it.
  async #cacheExists(): Promise<boolean> {
    return (await this.#deps.caches.keys()).includes(this.cacheName);
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

  /**
   * Answers a page's message; anything that is not one of the six message shapes is ignored. CANCEL_SAVE gets no reply
   * of its own: the SAVE_ALL it stops answers with `cancelled`.
   */
  async handleMessage(data: unknown, context: MessageContext = {}): Promise<MessageOutcome> {
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
    if (type === "SAVE_ALL") return this.saveAll(context.post);
    if (type === "CANCEL_SAVE") {
      this.cancelSave();
      return null;
    }
    return this.removeAll();
  }

  /**
   * Saves every file of this build's list that the cache does not hold yet, `SAVE_CONCURRENCY` at a time, checking
   * each as any store does, and posts progress to `post` after each file. A SAVE_ALL that arrives while one runs joins
   * it instead of starting another. Only the active worker saves, so a waiting build never fills its cache before the
   * reader presses Reload. The saved record is written only once every listed file is stored; a save that stops early
   * leaves a partial record, and the next SAVE_ALL skips the files already stored.
   */
  saveAll(post?: (message: SaveProgress) => void): Promise<SaveDone> {
    const running = this.#saving;
    if (running) {
      if (post) {
        running.listeners.add(post);
        post(progressOf(running));
      }
      return running.result;
    }
    if (this.#removing) return Promise.resolve(refused("busy"));
    const run: SaveRun = {
      done: 0,
      total: this.#files.size,
      bytes: 0,
      failed: [],
      listeners: new Set(post ? [post] : []),
      cancelled: false,
      result: Promise.resolve(refused("not-active")),
    };
    // Set before the first await, so a second SAVE_ALL that arrives meanwhile joins this one.
    this.#saving = run;
    run.result = this.#runSave(run).finally(() => {
      this.#saving = null;
    });
    return run.result;
  }

  /** Stops a running SAVE_ALL once the files it is downloading now are done; the files already stored stay. */
  cancelSave(): void {
    if (this.#saving) this.#saving.cancelled = true;
  }

  // Always resolves: a refused write anywhere, the records included, ends the save as partial with its reason, so the
  // page that asked always gets an answer.
  async #runSave(run: SaveRun): Promise<SaveDone> {
    try {
      return await this.#saveFiles(run);
    } catch (error) {
      const reason = isQuotaError(error) ? "quota" : "storage";
      return { type: "SAVE_DONE", result: "partial", reason, saved: null, failed: run.failed };
    }
  }

  async #saveFiles(run: SaveRun): Promise<SaveDone> {
    if (!(await this.#isActive())) return refused("not-active");
    const started = this.#now();
    const cache = await this.#cache();
    await this.#write(SAVED_RECORD, () => ({ at: started, build: this.#build.build, complete: false }));
    const stored = await this.#storedPaths(cache);
    for (const path of stored) {
      run.done++;
      run.bytes += this.#files.get(path)?.size ?? 0;
    }
    const emit = () => {
      const message = progressOf(run);
      for (const listener of run.listeners) {
        try {
          listener(message);
        } catch {
          // A page that has closed cannot be told; the save goes on for the others.
        }
      }
    };
    emit();
    const queue = [...this.#files.keys()].filter((path) => !stored.has(path));
    let stopped: "quota" | "gone" | null = null;
    const next = async (): Promise<void> => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        if (run.cancelled || stopped) return;
        if (!(await this.#stillSaving())) {
          stopped = "gone";
          return;
        }
        try {
          const reason = await this.#fetchAndStore(`${this.#deps.origin}${path}`);
          if (reason === null) {
            run.done++;
            run.bytes += this.#files.get(path)?.size ?? 0;
          } else run.failed.push({ path, reason });
        } catch (error) {
          // The browser refused the write. A full quota stops the save, since every later write would fail too.
          const reason = isQuotaError(error) ? "quota" : "storage";
          run.failed.push({ path, reason });
          await this.#problem(path, reason).catch(() => undefined);
          if (reason === "quota") stopped = "quota";
        }
        emit();
      }
    };
    await Promise.all(Array.from({ length: SAVE_CONCURRENCY }, next));
    // A later worker's activation deleted this cache. The files in flight may already have written it back with at
    // most one file each; the saved record is never written, and the next activation deletes that orphan cache.
    if (stopped === "gone") return { type: "SAVE_DONE", result: "partial", saved: null, failed: run.failed };
    // A cancel that came while the last file was in flight still leaves every file stored, which is a saved copy.
    const complete = (await this.#storedPaths(cache)).size === this.#files.size;
    if (!complete) {
      const reason =
        stopped === "quota"
          ? "quota"
          : run.failed.some((problem) => problem.reason === "storage")
            ? "storage"
            : undefined;
      return {
        type: "SAVE_DONE",
        result: run.cancelled ? "cancelled" : "partial",
        ...(reason ? { reason } : {}),
        saved: null,
        failed: run.failed,
      };
    }
    const at = this.#now();
    await this.#write(SAVED_RECORD, () => ({ at, build: this.#build.build, complete: true }));
    await cache.delete(`${this.#deps.origin}${PREVIOUS_RECORD}`);
    return {
      type: "SAVE_DONE",
      result: "saved",
      saved: { at, build: this.#build.build, files: this.#files.size, bytes: this.#totalBytes() },
      failed: [],
    };
  }

  async #storedPaths(cache: CacheLike): Promise<Set<string>> {
    const stored = new Set<string>();
    for (const request of await cache.keys()) {
      const key = this.keyFor(request.url);
      if (key) stored.add(new URL(key).pathname);
    }
    return stored;
  }

  #totalBytes(): number {
    let bytes = 0;
    for (const file of this.#files.values()) bytes += file.size;
    return bytes;
  }

  /**
   * Removes the reader's saved copy. It stops a running save and deletes every file of this build's cache but the
   * shell, so the book still opens. It clears the saved record and the problems of the files it deleted, and deletes
   * the older builds' caches that activate kept once no page of theirs is open; a cache an open page of an older build
   * still reads stays until that page closes. Only the active worker removes anything, and a refused delete answers
   * `removed: false`.
   */
  removeAll(): Promise<RemovedReply> {
    this.#removing ??= this.#remove().finally(() => {
      this.#removing = null;
    });
    return this.#removing;
  }

  async #remove(): Promise<RemovedReply> {
    try {
      return await this.#removeFiles();
    } catch {
      return { type: "REMOVED", removed: false };
    }
  }

  async #removeFiles(): Promise<RemovedReply> {
    if (!(await this.#isActive())) return { type: "REMOVED", removed: false };
    const running = this.#saving;
    if (running) {
      running.cancelled = true;
      await running.result.catch(() => undefined);
    }
    await this.#purge(await this.#cache());
    // Another build's cache can bring the copy back: a waiting build carried the files over and records them as
    // `previous`, and an older cache an open tab still reads holds its saved record for the next install to find.
    // This worker knows neither build's shell, so it deletes their records and marks them removed: install carries
    // nothing over from a marked cache, and a marked cache's own worker purges it when it activates.
    for (const name of await this.#deps.caches.keys()) {
      if (!name.startsWith(CACHE_PREFIX) || name === this.cacheName) continue;
      const other = await this.#deps.caches.open(name);
      await other.delete(`${this.#deps.origin}${SAVED_RECORD}`);
      await other.delete(`${this.#deps.origin}${PREVIOUS_RECORD}`);
      await other.put(`${this.#deps.origin}${REMOVED_RECORD}`, jsonResponse({ at: this.#now() }));
    }
    await this.pruneOlder();
    return { type: "REMOVED", removed: true };
  }

  // Deletes every file of this build's cache but the shell, the saved, previous and removed records, and the problems
  // of the deleted files.
  async #purge(cache: CacheLike): Promise<void> {
    const shell = new Set(this.#build.shell);
    for (const path of await this.#storedPaths(cache)) {
      if (!shell.has(path)) await cache.delete(`${this.#deps.origin}${path}`);
    }
    for (const record of [SAVED_RECORD, PREVIOUS_RECORD, REMOVED_RECORD]) {
      await cache.delete(`${this.#deps.origin}${record}`);
    }
    const problems = await this.#loadProblems();
    const before = problems.size;
    for (const path of [...problems.keys()]) if (!shell.has(path)) problems.delete(path);
    if (problems.size !== before) await this.#write(PROBLEMS_RECORD, () => Object.fromEntries(problems));
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
    const saved = await this.#storedPaths(cache);
    let totalBytes = 0;
    let savedBytes = 0;
    for (const [path, file] of this.#files) {
      totalBytes += file.size;
      if (saved.has(path)) savedBytes += file.size;
    }
    const entries = [...(await this.#loadProblems())].filter(([path]) => this.#files.has(path));
    const origin = this.#deps.origin;
    const record = savedRecord(await readJson(await cache.match(`${origin}${SAVED_RECORD}`)), this.#build.build);
    // A copy counts as saved only while the cache still holds every listed file, so an eviction shows as not saved. A
    // full cache is saved even if its record says partial, as when the worker stopped before the closing write.
    const whole = record !== null && saved.size === this.#files.size;
    const previous = whole ? null : previousRecord(await readJson(await cache.match(`${origin}${PREVIOUS_RECORD}`)));
    return {
      type: "STATUS",
      build: this.#build.build,
      total: { files: this.#files.size, bytes: totalBytes },
      stored: { files: saved.size, bytes: savedBytes },
      shell: { files: this.#build.shell.length, saved: this.#build.shell.filter((path) => saved.has(path)).length },
      saved:
        whole && record ? { at: record.at, build: record.build, files: this.#files.size, bytes: totalBytes } : null,
      partial: record && !whole ? { at: record.at } : null,
      previous,
      saving: this.#saving ? withoutType(progressOf(this.#saving)) : null,
      rewritten: entries.filter(([path, state]) => state === "rewritten" && saved.has(path)).map(([path]) => path),
      failed: entries
        .filter(([, state]) => state !== "rewritten")
        .map(([path, reason]) => ({ path, reason: reason as Problem["reason"] })),
    };
  }
}

function progressOf(run: SaveRun): SaveProgress {
  return { type: "SAVE_PROGRESS", done: run.done, total: run.total, bytes: run.bytes, failed: run.failed.length };
}

function withoutType({ type: _type, ...rest }: SaveProgress): Omit<SaveProgress, "type"> {
  return rest;
}

function refused(reason: "not-active" | "busy"): SaveDone {
  return { type: "SAVE_DONE", result: "refused", reason, saved: null, failed: [] };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

async function readJson(response: Response | undefined): Promise<unknown> {
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const BUILD_ID = /^[A-Za-z0-9_]{1,64}$/;

// The saved record of `build`, or null for anything else: another build's record, or one in a shape this worker never
// writes.
function savedRecord(value: unknown, build: string): { at: number; build: string; complete: boolean } | null {
  if (typeof value !== "object" || value === null) return null;
  const { at, build: recorded, complete } = value as Record<string, unknown>;
  if (typeof at !== "number" || !Number.isFinite(at) || recorded !== build || typeof complete !== "boolean")
    return null;
  return { at, build, complete };
}

function previousRecord(value: unknown): { at: number; build: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { at, build } = value as Record<string, unknown>;
  if (typeof at !== "number" || !Number.isFinite(at) || typeof build !== "string" || !BUILD_ID.test(build)) return null;
  return { at, build };
}
