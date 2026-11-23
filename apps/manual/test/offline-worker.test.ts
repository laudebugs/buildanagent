import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CACHE_PREFIX,
  cacheName,
  type FetchLike,
  NAVIGATION_TIMEOUT_MS,
  OfflineWorker,
  storable,
} from "../src/offline/worker.js";
import { basic, buildOf, FakeCaches, FakeNetwork, FakeTimer, ORIGIN, ok, request } from "./offline-fakes.js";

// The offline worker's logic (src/offline/worker.ts) against a fake Cache API, fetch and timer: what it stores, what
// it refuses, what each kind of request gets online, offline and on a slow network, and its messages.

const TEXTS = {
  "/": "<h1>Contents</h1>",
  "/offline/": "<h1>You're offline</h1>",
  "/tools/": "<h1>Tools</h1>",
  "/glossary/": "<h1>Glossary</h1>",
  "/_astro/BaseLayout.abc.css": "body{}",
  "/scripts/notes.js": "// notes",
  "/pagefind/pagefind-entry.json": '{"version":"1.6.0"}',
  "/sw.js": "// must never be cached",
};
const SHELL = ["/", "/offline/", "/_astro/BaseLayout.abc.css"];

function setup(table: ConstructorParameters<typeof FakeNetwork>[0] = {}, build = buildOf("b1", TEXTS, SHELL)) {
  const caches = new FakeCaches();
  const timer = new FakeTimer();
  const network = new FakeNetwork({
    ...Object.fromEntries(Object.entries(TEXTS).map(([path, text]) => [path, () => ok(text)])),
    ...table,
  });
  const worker = new OfflineWorker(build, { origin: ORIGIN, caches, fetch: network.fetch, delay: timer.delay });
  const pending: Promise<unknown>[] = [];
  const event = (req: Request, ids: { clientId?: string; resultingClientId?: string } = {}): FetchLike => ({
    request: req,
    ...ids,
    waitUntil: (promise) => pending.push(promise),
  });
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  const cached = async (path: string) => (await caches.open("manual-b1")).match(`${ORIGIN}${path}`);
  return { caches, timer, network, worker, event, settle, cached };
}

test("a cache is named by the build, and a key is the origin and path of a listed file alone", () => {
  const { worker } = setup();
  assert.equal(cacheName("b1"), `${CACHE_PREFIX}b1`);
  assert.equal(worker.cacheName, "manual-b1");
  assert.equal(worker.keyFor(`${ORIGIN}/tools/?q=1#top`), `${ORIGIN}/tools/`);
  assert.equal(
    worker.keyFor(`${ORIGIN}/pagefind/pagefind-entry.json?ts=123`),
    `${ORIGIN}/pagefind/pagefind-entry.json`,
  );
  assert.equal(worker.keyFor("https://evil.example/tools/"), null, "another origin");
  assert.equal(worker.keyFor("http://manual.buildanagent.fyi/tools/"), null, "another scheme is another origin");
  assert.equal(worker.keyFor(`${ORIGIN}/not-built/`), null, "a path the build did not write");
  assert.equal(worker.keyFor(`${ORIGIN}/sw.js`), null, "the worker script, even if a list names it");
  assert.equal(worker.keyFor("not a url"), null);
});

test("only a plain same-origin 200 that sets no cookie and allows storing is storable", () => {
  assert.ok(storable(ok("x")));
  assert.ok(storable(ok("x", { "cache-control": "no-cache" })), "no-cache allows storing");
  assert.ok(!storable(basic(new Response("x", { status: 404 }))), "a 404");
  assert.ok(!storable(basic(new Response("x", { status: 206 }))), "a partial response");
  assert.ok(!storable(new Response("x")), "not a basic response: opaque or CORS");
  const redirected = ok("x");
  Object.defineProperty(redirected, "redirected", { value: true });
  assert.ok(!storable(redirected), "a redirected response");
  for (const control of ["no-store", "private", "public, no-store", "max-age=0,private"]) {
    assert.ok(!storable(ok("x", { "cache-control": control })), control);
  }
  const cookie = ok("x");
  cookie.headers.append("set-cookie", "a=b");
  assert.ok(!storable(cookie), "a Set-Cookie");
  assert.ok(!storable(ok("x", { vary: "*" })), "Vary: *");
});

test("install saves the shell from the network, revalidating past the HTTP cache, and only this build's bytes", async () => {
  const { worker, network, cached } = setup();
  await worker.install();
  for (const path of SHELL) assert.equal(await (await cached(path))?.text(), TEXTS[path as keyof typeof TEXTS]);
  assert.equal(await cached("/tools/"), undefined, "a chapter is not part of the shell");
  assert.ok(network.requests.every((req) => req.cache === "no-cache" && req.redirect === "error"));
});

test("install fails when the server already holds another build's shell file, so the old worker keeps serving", async () => {
  const { worker } = setup({ "/offline/": () => ok("<h1>A newer offline page</h1>") });
  await assert.rejects(worker.install(), /\/offline\/ is not this build's file/);
});

test("install fails for a shell file that is a 404, a redirect or not on the list", async () => {
  await assert.rejects(setup({ "/offline/": () => basic(new Response("gone", { status: 404 })) }).worker.install());
  const odd = buildOf("b1", TEXTS, [...SHELL, "/missing/"]);
  await assert.rejects(setup({}, odd).worker.install(), /not a file of this build/);
});

test("install copies unchanged files from an older build's cache, never changed ones, and activate then deletes it", async () => {
  const { worker, caches, network, cached } = setup();
  const older = await caches.open("manual-b0");
  await older.put(`${ORIGIN}/tools/`, ok(TEXTS["/tools/"]));
  await older.put(`${ORIGIN}/glossary/`, ok("<h1>An older glossary</h1>"));
  await older.put(`${ORIGIN}/`, ok(TEXTS["/"]));
  const other = await caches.open("someone-elses-cache");
  await worker.install();
  assert.equal(await (await cached("/tools/"))?.text(), TEXTS["/tools/"]);
  assert.equal(await cached("/glossary/"), undefined, "a changed page is not carried over");
  assert.ok(!network.requests.some((req) => new URL(req.url).pathname === "/"), "the carried home page is not fetched");
  assert.ok(caches.stores.has("manual-b0"), "the older cache stays until activate");
  await worker.activate();
  assert.deepEqual([...caches.stores.keys()].sort(), ["manual-b1", "someone-elses-cache"]);
  assert.equal(caches.stores.get("someone-elses-cache"), other);
});

test("the worker leaves a POST, another origin, a range, the worker script and an unlisted file to the browser", () => {
  const { worker, event } = setup();
  assert.equal(worker.handleFetch(event(request("/tools/", { method: "POST", body: "x" }))), null);
  assert.equal(worker.handleFetch(event(request("https://evil.example/tools/"))), null);
  assert.equal(worker.handleFetch(event(request("https://evil.example/tools/", { navigate: true }))), null);
  assert.equal(worker.handleFetch(event(request("/tools/", { headers: { range: "bytes=0-1" } }))), null);
  assert.equal(worker.handleFetch(event(request("/sw.js"))), null);
  assert.equal(worker.handleFetch(event(request("/sw.js", { navigate: true }))), null);
  assert.equal(worker.handleFetch(event(request("/offline-manifest.json"))), null);
  assert.equal(worker.handleFetch(event(request("/unlisted.js"))), null);
});

test("online, a page comes from the network and is saved when its bytes are this build's", async () => {
  const { worker, event, settle, cached } = setup();
  const response = await worker.handleFetch(event(request("/tools/", { navigate: true })));
  assert.equal(await response?.text(), TEXTS["/tools/"]);
  await settle();
  assert.equal(await (await cached("/tools/"))?.text(), TEXTS["/tools/"]);
});

test("a page from a newer deploy, a 404 and a server error are shown but never saved", async () => {
  const { worker, event, settle, cached } = setup({
    "/tools/": () => ok("<h1>Tools, rewritten in a newer build</h1>"),
    "/glossary/": () => basic(new Response("<h1>Page not found</h1>", { status: 404 })),
    "/": () => basic(new Response("oops", { status: 500 })),
  });
  assert.match(
    (await (await worker.handleFetch(event(request("/tools/", { navigate: true }))))?.text()) ?? "",
    /newer/,
  );
  assert.equal((await worker.handleFetch(event(request("/glossary/", { navigate: true }))))?.status, 404);
  assert.equal((await worker.handleFetch(event(request("/", { navigate: true }))))?.status, 500);
  const unknown = await worker.handleFetch(event(request("/no-such-page/", { navigate: true })));
  assert.equal(unknown?.status, 404, "an unknown page gets the server's 404, not the offline page");
  await settle();
  for (const path of ["/tools/", "/glossary/", "/"]) assert.equal(await cached(path), undefined, path);
});

const OFFLINE_TABLE = { "/tools/": "offline", "/glossary/": "offline", "/nowhere/": "offline" } as const;

async function saveTools(caches: FakeCaches) {
  await (await caches.open("manual-b1")).put(`${ORIGIN}/tools/`, ok(TEXTS["/tools/"]));
}

test("offline, a saved page opens whatever its query string, and any other page gets the offline page", async () => {
  const { worker, event, caches } = setup();
  await worker.install();
  await saveTools(caches);
  const offline = setup(OFFLINE_TABLE);
  const reader = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: offline.network.fetch,
    delay: offline.timer.delay,
  });
  const page = (path: string) => reader.handleFetch(event(request(path, { navigate: true })));
  assert.equal(await (await page("/tools/?from=contents"))?.text(), TEXTS["/tools/"]);
  assert.equal(await (await page("/glossary/"))?.text(), TEXTS["/offline/"], "a listed page that is not saved");
  assert.equal(await (await page("/nowhere/"))?.text(), TEXTS["/offline/"], "a page the build never wrote");
});

test("offline with nothing saved, a page fails as a network error rather than showing a stale or foreign page", async () => {
  const { worker, event } = setup(OFFLINE_TABLE);
  const response = await worker.handleFetch(event(request("/tools/", { navigate: true })));
  assert.equal(response?.type, "error");
});

test(`on a slow network a saved page shows after ${NAVIGATION_TIMEOUT_MS} ms, and an unsaved one waits for the network`, async () => {
  let release: (response: Response) => void = () => undefined;
  const { worker, event, caches, timer, cached } = setup({
    "/tools/": "hang",
    "/glossary/": () => ok(TEXTS["/glossary/"]),
  });
  await worker.install();
  await saveTools(caches);
  const slow = worker.handleFetch(event(request("/tools/", { navigate: true })));
  await Promise.resolve();
  timer.fire();
  assert.equal(await (await slow)?.text(), TEXTS["/tools/"]);

  // The glossary is not saved: the timeout passes, and the page still arrives from the network.
  const late = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const network = new FakeNetwork({ "/glossary/": "hang" });
  const waiting = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: (req) => (new URL(req.url).pathname === "/glossary/" ? late : network.fetch(req)),
    delay: timer.delay,
  });
  const page = waiting.handleFetch(event(request("/glossary/", { navigate: true })));
  await Promise.resolve();
  timer.fire();
  await new Promise((resolve) => setTimeout(resolve, 5));
  release(ok(TEXTS["/glossary/"]));
  assert.equal(await (await page)?.text(), TEXTS["/glossary/"]);
  // The hanging chapter request keeps its own write pending forever, so this waits for the glossary's write alone.
  for (let i = 0; i < 50 && !(await cached("/glossary/")); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(await (await cached("/glossary/"))?.text(), TEXTS["/glossary/"], "and is saved once it arrives");
});

test("a content-addressed file comes from the cache without a request once saved", async () => {
  const { worker, event, network } = setup();
  await worker.install();
  const before = network.requests.length;
  const response = await worker.handleFetch(event(request("/_astro/BaseLayout.abc.css")));
  assert.equal(await response?.text(), TEXTS["/_astro/BaseLayout.abc.css"]);
  assert.equal(network.requests.length, before);
});

test("any other file comes from the network online, is saved under its path, and from the cache offline", async () => {
  const { worker, event, settle, caches } = setup();
  const entry = "/pagefind/pagefind-entry.json";
  assert.equal(await (await worker.handleFetch(event(request(`${entry}?ts=1`))))?.text(), TEXTS[entry]);
  await settle();
  assert.ok(await (await caches.open("manual-b1")).match(`${ORIGIN}${entry}`), "saved without its query string");
  const offline = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: new FakeNetwork({ [entry]: "offline", "/scripts/notes.js": "offline" }).fetch,
  });
  assert.equal(await (await offline.handleFetch(event(request(`${entry}?ts=2`))))?.text(), TEXTS[entry]);
  await assert.rejects(
    offline.handleFetch(event(request("/scripts/notes.js"))) ?? Promise.resolve(),
    /Failed to fetch/,
    "an unsaved file fails as the network did",
  );
});

test("a page shown from the cache gets its assets from the same build's cache, not the network", async () => {
  const { worker, event, caches, network } = setup({ "/tools/": "offline" });
  await worker.install();
  await saveTools(caches);
  await (await caches.open("manual-b1")).put(`${ORIGIN}/scripts/notes.js`, ok(TEXTS["/scripts/notes.js"]));
  await worker.handleFetch(event(request("/tools/", { navigate: true }), { resultingClientId: "tab-1" }));
  const before = network.requests.length;
  const script = await worker.handleFetch(event(request("/scripts/notes.js"), { clientId: "tab-1" }));
  assert.equal(await script?.text(), TEXTS["/scripts/notes.js"]);
  assert.equal(network.requests.length, before, "no request: the cached page's script is the cached build's");
  await worker.handleFetch(event(request("/scripts/notes.js"), { clientId: "tab-2" }));
  assert.equal(network.requests.length, before + 1, "another page asks the network first");
});

test("STATUS counts what this build's cache holds, SKIP_WAITING asks to take over, and the save messages wait for T67b", async () => {
  const { worker } = setup();
  await worker.install();
  const listed = Object.entries(TEXTS).filter(([path]) => path !== "/sw.js");
  const status = await worker.handleMessage({ type: "STATUS" });
  assert.deepEqual(status, {
    type: "STATUS",
    build: "b1",
    total: { files: listed.length, bytes: listed.reduce((sum, [, text]) => sum + Buffer.byteLength(text), 0) },
    saved: {
      files: SHELL.length,
      bytes: SHELL.reduce((sum, path) => sum + Buffer.byteLength(TEXTS[path as keyof typeof TEXTS]), 0),
    },
    shell: { files: SHELL.length, saved: SHELL.length },
  });
  assert.deepEqual(await worker.handleMessage({ type: "SKIP_WAITING" }), { type: "SKIP_WAITING" });
  assert.deepEqual(await worker.handleMessage({ type: "SAVE_ALL" }), { type: "UNSUPPORTED", request: "SAVE_ALL" });
  assert.deepEqual(await worker.handleMessage({ type: "REMOVE_ALL" }), { type: "UNSUPPORTED", request: "REMOVE_ALL" });
  for (const junk of [null, undefined, "SKIP_WAITING", 1, {}, { type: "skip_waiting" }, { type: "__proto__" }]) {
    assert.equal(await worker.handleMessage(junk), null, JSON.stringify(junk));
  }
});
