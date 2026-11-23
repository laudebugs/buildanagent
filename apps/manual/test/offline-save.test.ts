import assert from "node:assert/strict";
import { test } from "vitest";
import {
  fromBookWindow,
  OfflineWorker,
  SAVE_CONCURRENCY,
  type SaveProgress,
  type WorkerDeps,
} from "../src/offline/worker.js";
import { buildOf, FakeCaches, FakeNetwork, ORIGIN, ok } from "./offline-fakes.js";

// Saving the whole book for offline reading (SAVE_ALL), stopping (CANCEL_SAVE) and removing it (REMOVE_ALL), in the
// worker's logic (src/offline/worker.ts) against the fake Cache API and fetch: progress, the partial-save rule, a
// refused quota, a second save at once, a save during an update, and which senders the worker listens to.

const CHAPTERS = Array.from({ length: 14 }, (_, i) => `/chapter-${i + 1}/`);
const TEXTS: Record<string, string> = {
  "/": '<meta name="manual-build" content="b1"><h1>Contents</h1>',
  "/offline/": "<h1>You're offline</h1>",
  "/_astro/BaseLayout.abc.css": "body{}",
  "/glossary/": "<h1>Glossary</h1>",
  "/scripts/notes.js": "// notes",
  ...Object.fromEntries(CHAPTERS.map((path, i) => [path, `<h1>Chapter ${i + 1}</h1>`])),
};
const SHELL = ["/", "/offline/", "/_astro/BaseLayout.abc.css"];
const FILES = Object.keys(TEXTS).length;
// The list records each page with the placeholder in its build mark, so the bytes are the list's, not the texts'.
const bytesOf = (texts: Record<string, string>) =>
  Object.values(buildOf("b", texts, []).files).reduce((sum, file) => sum + file.size, 0);
const BYTES = bytesOf(TEXTS);

type Table = ConstructorParameters<typeof FakeNetwork>[0];
const served = (texts: Record<string, string>): Table =>
  Object.fromEntries(Object.entries(texts).map(([path, text]) => [path, () => ok(text)]));

/** A worker for build b1 that has installed and activated, over fresh caches unless some are given. */
async function active(table: Table = {}, extra: Partial<WorkerDeps> = {}, build = buildOf("b1", TEXTS, SHELL)) {
  const caches = (extra.caches as FakeCaches | undefined) ?? new FakeCaches();
  const network = new FakeNetwork({ ...served(TEXTS), ...table });
  const worker = new OfflineWorker(build, { origin: ORIGIN, caches, fetch: network.fetch, now: () => 1_000, ...extra });
  await worker.install();
  await worker.activate();
  return { worker, caches, network, cache: () => caches.open(worker.cacheName) };
}

const fetchedPaths = (network: FakeNetwork) => network.requests.map((request) => new URL(request.url).pathname);

test("SAVE_ALL downloads every listed file the cache lacks, reports progress after each, and records the saved copy", async () => {
  const { worker, network } = await active();
  const before = network.requests.length;
  const progress: SaveProgress[] = [];
  const done = await worker.handleMessage({ type: "SAVE_ALL" }, { post: (message) => progress.push(message) });
  assert.deepEqual(done, {
    type: "SAVE_DONE",
    result: "saved",
    saved: { at: 1_000, build: "b1", files: FILES, bytes: BYTES },
    failed: [],
  });
  const fetched = fetchedPaths(network).slice(before);
  assert.equal(fetched.length, FILES - SHELL.length, "the shell is already stored, so it is not fetched again");
  assert.ok(!fetched.some((path) => SHELL.includes(path)));
  assert.equal(progress[0]?.done, SHELL.length, "the first report counts what was already stored");
  assert.deepEqual(progress.at(-1), { type: "SAVE_PROGRESS", done: FILES, total: FILES, bytes: BYTES, failed: 0 });
  for (let i = 1; i < progress.length; i++) assert.ok((progress[i]?.done ?? 0) >= (progress[i - 1]?.done ?? 0));
  const status = await worker.status();
  assert.deepEqual(status.saved, { at: 1_000, build: "b1", files: FILES, bytes: BYTES });
  assert.equal(status.partial, null);
  assert.equal(status.saving, null);
});

test(`SAVE_ALL downloads at most ${SAVE_CONCURRENCY} files at once`, async () => {
  let inFlight = 0;
  let peak = 0;
  const network = new FakeNetwork(served(TEXTS));
  const slow = async (request: Request) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    return network.fetch(request);
  };
  const { worker } = await active({}, { fetch: slow });
  assert.equal((await worker.saveAll()).result, "saved");
  assert.ok(peak > 1 && peak <= SAVE_CONCURRENCY, `peak ${peak}`);
});

test("SAVE_ALL takes no paths: it saves the build's own list and never fetches a URL a message names", async () => {
  const { worker, network } = await active();
  await worker.handleMessage({ type: "SAVE_ALL", paths: ["https://evil.example/x", "/unlisted/"] });
  const fetched = fetchedPaths(network);
  assert.ok(!fetched.includes("/unlisted/"));
  assert.ok(network.requests.every((request) => request.url.startsWith(`${ORIGIN}/`)));
});

test("a save that loses the connection is partial, never saved, and the next one fetches only the missing files", async () => {
  let down = true;
  const { worker, network } = await active({
    "/chapter-3/": () => {
      if (down) throw new TypeError("Failed to fetch");
      return ok(TEXTS["/chapter-3/"] ?? "");
    },
  });
  const first = await worker.saveAll();
  assert.equal(first.result, "partial");
  assert.equal(first.saved, null);
  assert.deepEqual(first.failed, [{ path: "/chapter-3/", reason: "network" }]);
  const status = await worker.status();
  assert.equal(status.saved, null, "a partial save is never shown as saved");
  assert.deepEqual(status.partial, { at: 1_000 });
  assert.deepEqual(status.failed, [{ path: "/chapter-3/", reason: "network" }]);
  assert.equal(status.stored.files, FILES - 1);

  down = false;
  const before = network.requests.length;
  const second = await worker.saveAll();
  assert.equal(second.result, "saved");
  assert.deepEqual(fetchedPaths(network).slice(before), ["/chapter-3/"], "the stored files are skipped");
  const after = await worker.status();
  assert.equal(after.partial, null);
  assert.deepEqual(after.failed, []);
  assert.equal(after.saved?.files, FILES);
});

test("a refused quota stops the save, leaves the shell and a partial state with the failure, and never says saved", async () => {
  const { worker, network, cache } = await active();
  const store = await cache();
  let puts = 0;
  store.refuse = (key) =>
    key.includes("__manual-offline__") || ++puts <= 4
      ? null
      : new DOMException("The quota was exceeded.", "QuotaExceededError");
  const before = network.requests.length;
  const done = await worker.saveAll();
  assert.equal(done.result, "partial");
  assert.equal(done.saved, null);
  assert.ok(done.failed.some((problem) => problem.reason === "quota"));
  assert.ok(
    network.requests.length - before < FILES - SHELL.length,
    "the save stopped instead of fetching every remaining file",
  );
  store.refuse = null;
  const status = await worker.status();
  assert.equal(status.shell.saved, SHELL.length, "the shell is intact, so the book still opens");
  assert.equal(status.saved, null);
  assert.deepEqual(status.partial, { at: 1_000 });
  assert.ok(status.failed.some((problem) => problem.reason === "quota"));
  assert.equal(status.stored.files, SHELL.length + 4);
});

test("another refused write is reported as a storage problem and the save goes on", async () => {
  const { worker, cache } = await active();
  (await cache()).refuse = (key) =>
    key.endsWith("/chapter-5/") ? new DOMException("The operation is insecure.", "SecurityError") : null;
  const done = await worker.saveAll();
  assert.equal(done.result, "partial");
  assert.deepEqual(done.failed, [{ path: "/chapter-5/", reason: "storage" }]);
  assert.equal((await worker.status()).stored.files, FILES - 1);
});

test("a newer deploy's file during a save is reported as other-build and leaves the save partial", async () => {
  const { worker } = await active({ "/glossary/": () => ok('<meta name="manual-build" content="b2"><h1>New</h1>') });
  const done = await worker.saveAll();
  assert.equal(done.result, "partial");
  assert.deepEqual(done.failed, [{ path: "/glossary/", reason: "other-build" }]);
  assert.deepEqual((await worker.status()).failed, [], "another build's file is no fault of this build's");
});

/** A network whose answers wait until the test releases them. */
function gated() {
  const network = new FakeNetwork(served(TEXTS));
  const waiting: (() => void)[] = [];
  const fetch = (request: Request) =>
    new Promise<Response>((resolve, reject) => {
      waiting.push(() => network.fetch(request).then(resolve, reject));
    });
  const release = async (count = Number.POSITIVE_INFINITY) => {
    for (let i = 0; i < count && waiting.length; i++) waiting.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 1));
  };
  return { network, fetch, release, waiting };
}

/** A worker installed and activated with every request answered, that then saves over a gated network. */
async function activeThenGated() {
  const caches = new FakeCaches();
  await active({}, { caches });
  const gate = gated();
  const worker = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: gate.fetch,
    now: () => 2_000,
  });
  return { worker, caches, gate };
}

test("CANCEL_SAVE stops the save after the files in flight; what was stored stays, and a new save resumes", async () => {
  const { worker, gate } = await activeThenGated();
  const progress: SaveProgress[] = [];
  const saving = worker.saveAll((message) => progress.push(message));
  await gate.release(0);
  assert.equal(gate.waiting.length, SAVE_CONCURRENCY);
  assert.equal(await worker.handleMessage({ type: "CANCEL_SAVE" }), null, "CANCEL_SAVE has no reply of its own");
  await gate.release();
  const done = await saving;
  assert.equal(done.result, "cancelled");
  assert.equal(done.saved, null);
  const status = await worker.status();
  assert.equal(status.stored.files, SHELL.length + SAVE_CONCURRENCY, "only the files in flight were stored");
  assert.deepEqual(status.partial, { at: 2_000 });
  const resumed = worker.saveAll();
  for (let i = 0; i < 10; i++) await gate.release();
  assert.equal((await resumed).result, "saved");
});

test("a second SAVE_ALL while one runs joins it: each file is fetched once, and both pages hear the progress", async () => {
  const { worker, gate } = await activeThenGated();
  const first: SaveProgress[] = [];
  const second: SaveProgress[] = [];
  const a = worker.saveAll((message) => first.push(message));
  const b = worker.saveAll((message) => second.push(message));
  assert.equal((await worker.status()).saving?.total, FILES, "STATUS shows the save running");
  for (let i = 0; i < 10; i++) await gate.release();
  const [doneA, doneB] = await Promise.all([a, b]);
  assert.equal(doneA, doneB);
  assert.equal(doneA.result, "saved");
  const fetched = fetchedPaths(gate.network);
  assert.equal(new Set(fetched).size, fetched.length, "no file fetched twice");
  assert.equal(second[0]?.type, "SAVE_PROGRESS", "the joining page gets the progress so far at once");
  assert.equal(second.at(-1)?.done, FILES);
  assert.equal(first.at(-1)?.done, FILES);
});

test("a waiting worker refuses SAVE_ALL and REMOVE_ALL, so an update never downloads before the reader's Reload", async () => {
  const caches = new FakeCaches();
  await active({}, { caches });
  const network = new FakeNetwork(served({ ...TEXTS, "/glossary/": "<h1>New glossary</h1>" }));
  const waiting = new OfflineWorker(buildOf("b2", { ...TEXTS, "/glossary/": "<h1>New glossary</h1>" }, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: network.fetch,
  });
  await waiting.install();
  const before = network.requests.length;
  assert.deepEqual(await waiting.saveAll(), {
    type: "SAVE_DONE",
    result: "refused",
    reason: "not-active",
    saved: null,
    failed: [],
  });
  assert.deepEqual(await waiting.removeAll(), { type: "REMOVED", removed: false });
  assert.equal(network.requests.length, before);

  // Once it activates, and after the browser restarts it, it saves.
  await waiting.activate();
  const restarted = new OfflineWorker(buildOf("b2", { ...TEXTS, "/glossary/": "<h1>New glossary</h1>" }, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: network.fetch,
  });
  assert.equal((await restarted.saveAll()).result, "saved");
});

test("an update carries the saved copy over, STATUS offers to update it, and saving again fetches only what changed", async () => {
  const caches = new FakeCaches();
  const old = await active({}, { caches });
  assert.equal((await old.worker.saveAll()).result, "saved");
  const changed = { ...TEXTS, "/glossary/": "<h1>Glossary, edited</h1>" };
  const network = new FakeNetwork(served(changed));
  const next = new OfflineWorker(buildOf("b2", changed, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: network.fetch,
    now: () => 5_000,
  });
  await next.install();
  await next.activate();
  const status = await next.status();
  assert.equal(status.saved, null, "the new build has no saved copy of its own yet");
  assert.deepEqual(status.previous, { at: 1_000, build: "b1" });
  assert.equal(status.stored.files, FILES - 1, "every unchanged file carried over");
  const before = network.requests.length;
  const done = await next.saveAll();
  assert.equal(done.result, "saved");
  assert.deepEqual(fetchedPaths(network).slice(before), ["/glossary/"]);
  const after = await next.status();
  assert.deepEqual(after.saved, {
    at: 5_000,
    build: "b2",
    files: FILES,
    bytes: bytesOf(changed),
  });
  assert.equal(after.previous, null);
});

test("a saved page carries over through two updates, though the first update stamped it with its own mark", async () => {
  const caches = new FakeCaches();
  const marked = { ...TEXTS, "/glossary/": '<meta name="manual-build" content="b1"><h1>Glossary</h1>' };
  const first = await active(served(marked), { caches }, buildOf("b1", marked, SHELL));
  assert.equal((await first.worker.saveAll()).result, "saved");
  const offline = new FakeNetwork(Object.fromEntries(Object.keys(TEXTS).map((path) => [path, "offline" as const])));
  for (const build of ["b2", "b3"]) {
    const next = new OfflineWorker(buildOf(build, marked, SHELL), { origin: ORIGIN, caches, fetch: offline.fetch });
    await next.install();
    await next.activate();
    const glossary = await (await caches.open(`manual-${build}`)).match(`${ORIGIN}/glossary/`);
    assert.match((await glossary?.text()) ?? "", new RegExp(`content="${build}"`), `carried into ${build}`);
  }
});

test("an old worker whose cache a new build's activation deleted stops saving and does not bring the cache back", async () => {
  const caches = new FakeCaches();
  await active({}, { caches });
  const gate = gated();
  const old = new OfflineWorker(buildOf("b1", TEXTS, SHELL), { origin: ORIGIN, caches, fetch: gate.fetch });
  const saving = old.saveAll();
  await gate.release(0);
  await caches.delete("manual-b1");
  for (let i = 0; i < 5; i++) await gate.release();
  const done = await saving;
  assert.equal(done.result, "partial");
  // The files in flight when the cache went may have been written back, but never the saved record.
  const revived = caches.stores.get("manual-b1");
  assert.ok(!revived || !(await revived.match(`${ORIGIN}/__manual-offline__/saved.json`))?.ok);
});

test("REMOVE_ALL stops a save, keeps the shell, deletes every other file and the saved record, and older kept caches", async () => {
  const caches = new FakeCaches();
  const older = await caches.open("manual-b0");
  await older.put(`${ORIGIN}/__manual-offline__/clients.json`, ok('["tab-old"]'));
  const { worker } = await active({}, { caches, openClients: async () => ["tab-old"] });
  assert.ok(caches.stores.has("manual-b0"), "kept while its page is open");
  assert.equal((await worker.saveAll()).result, "saved");
  assert.deepEqual(await worker.handleMessage({ type: "REMOVE_ALL" }), { type: "REMOVED", removed: true });
  const status = await worker.status();
  assert.equal(status.saved, null);
  assert.equal(status.partial, null);
  assert.equal(status.stored.files, SHELL.length);
  assert.equal(status.shell.saved, SHELL.length, "the book still opens");
  assert.ok(!caches.stores.has("manual-b0"), "the older kept cache is gone");
  assert.deepEqual(status.failed, []);
});

test("REMOVE_ALL during a save cancels it first, and a SAVE_ALL during the removal is refused as busy", async () => {
  const { worker, gate } = await activeThenGated();
  const saving = worker.saveAll();
  await gate.release(0);
  const removing = worker.removeAll();
  await gate.release(0);
  const joined = worker.saveAll();
  await gate.release();
  assert.equal((await saving).result, "cancelled");
  assert.equal((await joined).result, "cancelled", "a SAVE_ALL while the save winds down joins it");
  assert.deepEqual(await removing, { type: "REMOVED", removed: true });
  assert.equal((await worker.status()).stored.files, SHELL.length);
  const again = worker.removeAll();
  assert.deepEqual(await worker.saveAll(), {
    type: "SAVE_DONE",
    result: "refused",
    reason: "busy",
    saved: null,
    failed: [],
  });
  await again;
});

test("an evicted cache shows as not saved, with no partial save", async () => {
  const { worker, caches } = await active();
  assert.equal((await worker.saveAll()).result, "saved");
  for (const name of await caches.keys()) await caches.delete(name);
  const restarted = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: new FakeNetwork({}).fetch,
  });
  const status = await restarted.status();
  assert.equal(status.saved, null);
  assert.equal(status.partial, null);
  assert.equal(status.stored.files, 0);
});

test("a saved copy with a file gone is not saved but partial", async () => {
  const { worker, cache } = await active();
  await worker.saveAll();
  await (await cache()).delete(`${ORIGIN}/chapter-2/`);
  const status = await worker.status();
  assert.equal(status.saved, null);
  assert.deepEqual(status.partial, { at: 1_000 });
});

test("the worker listens only to a tab or window of its own origin, never to a frame, a worker or another origin", () => {
  const page = { type: "window", frameType: "top-level", url: `${ORIGIN}/tools/` };
  assert.ok(fromBookWindow(ORIGIN, { origin: ORIGIN, source: page }));
  assert.ok(fromBookWindow(ORIGIN, { origin: ORIGIN, source: { ...page, frameType: "auxiliary" } }), "a popup");
  assert.ok(!fromBookWindow(ORIGIN, { origin: "https://evil.example", source: page }), "another origin");
  assert.ok(!fromBookWindow(ORIGIN, { origin: ORIGIN, source: { ...page, frameType: "nested" } }), "an iframe");
  assert.ok(!fromBookWindow(ORIGIN, { origin: ORIGIN, source: { ...page, frameType: "none" } }));
  assert.ok(!fromBookWindow(ORIGIN, { origin: ORIGIN, source: { type: "worker", url: `${ORIGIN}/x.js` } }));
  assert.ok(!fromBookWindow(ORIGIN, { origin: ORIGIN, source: null }), "a MessagePort or no source");
  assert.ok(!fromBookWindow(ORIGIN, { origin: ORIGIN, source: { ...page, url: "https://evil.example/" } }));
  assert.ok(!fromBookWindow(ORIGIN, { origin: ORIGIN, source: { ...page, url: "not a url" } }));
});
