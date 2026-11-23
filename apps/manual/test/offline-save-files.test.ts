import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { SAVE_FILES_LIMIT as PAGE_LIMIT } from "../public/scripts/reading-offline.js";
import {
  fromBookWindow,
  OfflineWorker,
  SAVE_FILES_LIMIT,
  SAVE_FILES_PREFIX,
  type WorkerDeps,
} from "../src/offline/worker.js";
import { buildOf, FakeCaches, FakeNetwork, ORIGIN, ok } from "./offline-fakes.js";

// SAVE_FILES (ADR 0059): the reading settings panel asks the worker to save the chosen pairing's fonts, which the shell
// leaves out. The worker saves only plain paths under /fonts/ that are on its build's list, checks their bytes as any
// store does, never downloads a file twice, and saves nothing unless it is the active worker.

const FONTS = {
  "/fonts/bitter/bitter-roman.woff2": "bitter roman bytes",
  "/fonts/bitter/bitter-italic.woff2": "bitter italic bytes",
  "/fonts/inter/inter-roman.woff2": "inter roman bytes",
};
const TEXTS: Record<string, string> = {
  "/": '<meta name="manual-build" content="b1"><h1>Contents</h1>',
  "/offline/": "<h1>You're offline</h1>",
  "/_astro/BaseLayout.abc.css": "body{}",
  "/chapter-1/": "<h1>Chapter 1</h1>",
  "/scripts/notes.js": "// notes",
  ...FONTS,
};
const SHELL = ["/", "/offline/", "/_astro/BaseLayout.abc.css"];
const BITTER = ["/fonts/bitter/bitter-roman.woff2", "/fonts/bitter/bitter-italic.woff2"];

type Table = ConstructorParameters<typeof FakeNetwork>[0];
const served = (texts: Record<string, string>): Table =>
  Object.fromEntries(Object.entries(texts).map(([path, text]) => [path, () => ok(text)]));

/** A worker for build b1 that has installed and activated. */
async function active(table: Table = {}, extra: Partial<WorkerDeps> = {}) {
  const caches = new FakeCaches();
  const network = new FakeNetwork({ ...served(TEXTS), ...table });
  const worker = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: network.fetch,
    now: () => 1_000,
    ...extra,
  });
  await worker.install();
  await worker.activate();
  return { worker, caches, network, cache: () => caches.open(worker.cacheName) };
}

const fetched = (network: FakeNetwork) => network.requests.map((request) => new URL(request.url).pathname);

test("SAVE_FILES saves a pairing's listed fonts, checked, and answers SAVED_FILES", async () => {
  const { worker, network, cache } = await active();
  const reply = await worker.handleMessage({ type: "SAVE_FILES", paths: BITTER });
  assert.deepEqual(reply, { type: "SAVED_FILES", saved: BITTER, failed: [] });
  assert.deepEqual(
    fetched(network).filter((path) => path.startsWith("/fonts/")),
    BITTER,
  );
  const store = await cache();
  for (const path of BITTER) assert.ok(await store.match(`${ORIGIN}${path}`), `${path} is in the cache`);
  assert.ok(!(await store.match(`${ORIGIN}/fonts/inter/inter-roman.woff2`)), "a font nobody asked for is not saved");
});

test("a font the cache holds is answered as saved without a download, and a repeated path is saved once", async () => {
  const { worker, network } = await active();
  await worker.saveFiles(BITTER);
  const before = network.requests.length;
  const again = await worker.saveFiles([...BITTER, BITTER[0] ?? "", BITTER[1] ?? ""]);
  assert.deepEqual(again, { type: "SAVED_FILES", saved: BITTER, failed: [] });
  assert.equal(network.requests.length, before, "nothing is downloaded twice");
});

test("only plain paths of the build's fonts are saved; every other path is refused with its reason and never fetched", async () => {
  const { worker, network } = await active();
  const before = network.requests.length;
  const reply = await worker.saveFiles([
    "/scripts/notes.js",
    "/chapter-1/",
    "https://evil.example/fonts/x.woff2",
    "/fonts/../sw.js",
    "/fonts/%2e%2e/sw.js",
    "/fonts/bitter/bitter-roman.woff2?v=2",
    "/fonts/bitter/bitter-roman.woff2#x",
    "/fonts//bitter/bitter-roman.woff2",
    "/fonts\\bitter\\bitter-roman.woff2",
    "/fonts/bitter%2Fbitter-roman.woff2",
    "/fonts/bitter/missing.woff2",
    "/fonts/",
    "/Fonts/bitter/bitter-roman.woff2",
  ]);
  assert.deepEqual(reply.saved, []);
  assert.deepEqual(reply.failed, [
    { path: "/scripts/notes.js", reason: "not-allowed" },
    { path: "/chapter-1/", reason: "not-allowed" },
    { path: "https://evil.example/fonts/x.woff2", reason: "not-allowed" },
    { path: "/fonts/../sw.js", reason: "not-allowed" },
    { path: "/fonts/%2e%2e/sw.js", reason: "not-allowed" },
    { path: "/fonts/bitter/bitter-roman.woff2?v=2", reason: "not-allowed" },
    { path: "/fonts/bitter/bitter-roman.woff2#x", reason: "not-allowed" },
    { path: "/fonts//bitter/bitter-roman.woff2", reason: "not-allowed" },
    { path: "/fonts\\bitter\\bitter-roman.woff2", reason: "not-allowed" },
    { path: "/fonts/bitter%2Fbitter-roman.woff2", reason: "not-allowed" },
    { path: "/fonts/bitter/missing.woff2", reason: "not-listed" },
    { path: "/fonts/", reason: "not-listed" },
    { path: "/Fonts/bitter/bitter-roman.woff2", reason: "not-allowed" },
  ]);
  assert.equal(network.requests.length, before, "no refused path reaches the network");
  assert.equal(SAVE_FILES_PREFIX, "/fonts/");
});

test(`a message with more than ${SAVE_FILES_LIMIT} paths, or without a list, is ignored`, async () => {
  const { worker, network } = await active();
  const before = network.requests.length;
  const many = Array.from({ length: SAVE_FILES_LIMIT + 1 }, () => BITTER[0]);
  assert.equal(await worker.handleMessage({ type: "SAVE_FILES", paths: many }), null);
  assert.equal(await worker.handleMessage({ type: "SAVE_FILES", paths: BITTER[0] }), null);
  assert.equal(await worker.handleMessage({ type: "SAVE_FILES" }), null);
  assert.equal(network.requests.length, before);
  const atLimit = Array.from({ length: SAVE_FILES_LIMIT }, () => BITTER[0]);
  assert.equal((await worker.handleMessage({ type: "SAVE_FILES", paths: atLimit }))?.type, "SAVED_FILES");
  assert.equal(PAGE_LIMIT, SAVE_FILES_LIMIT, "the page never sends more than the worker takes");
});

test("entries that are not strings are dropped, and the strings among them are still answered", async () => {
  const { worker } = await active();
  const reply = await worker.handleMessage({ type: "SAVE_FILES", paths: [42, null, { path: "/x" }, BITTER[0]] });
  assert.deepEqual(reply, { type: "SAVED_FILES", saved: [BITTER[0]], failed: [] });
});

test("a font whose bytes differ from the list is not saved, and the answer says why", async () => {
  const { worker, cache } = await active({ "/fonts/bitter/bitter-italic.woff2": () => ok("someone else's bytes") });
  const reply = await worker.saveFiles(BITTER);
  assert.deepEqual(reply.saved, [BITTER[0]]);
  assert.deepEqual(reply.failed, [{ path: BITTER[1], reason: "different-bytes" }]);
  assert.ok(!(await (await cache()).match(`${ORIGIN}${BITTER[1]}`)));
  assert.deepEqual((await worker.status()).failed, [{ path: BITTER[1], reason: "different-bytes" }]);
});

test("a dropped connection and a refused write are reported per file", async () => {
  const { worker, cache } = await active({ "/fonts/bitter/bitter-roman.woff2": "offline" });
  (await cache()).refuse = (key) =>
    key.endsWith("bitter-italic.woff2") ? new DOMException("The quota was exceeded.", "QuotaExceededError") : null;
  const reply = await worker.saveFiles(BITTER);
  assert.deepEqual(reply.failed, [
    { path: BITTER[0], reason: "network" },
    { path: BITTER[1], reason: "quota" },
  ]);
});

test("a worker that is not the active one saves nothing and says so", async () => {
  const caches = new FakeCaches();
  const network = new FakeNetwork(served(TEXTS));
  const waiting = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: network.fetch,
    isActive: () => false,
  });
  await waiting.install();
  const before = network.requests.length;
  const reply = await waiting.saveFiles([...BITTER, "/scripts/notes.js"]);
  assert.deepEqual(reply.saved, []);
  assert.deepEqual(reply.failed, [
    { path: "/scripts/notes.js", reason: "not-allowed" },
    { path: BITTER[0], reason: "not-active" },
    { path: BITTER[1], reason: "not-active" },
  ]);
  assert.equal(network.requests.length, before);
});

/** A fetch whose font answers wait until the test releases them. */
function gatedFonts(network: FakeNetwork) {
  const waiting: (() => void)[] = [];
  const fetch = (request: Request) =>
    new URL(request.url).pathname.startsWith("/fonts/")
      ? new Promise<Response>((resolve, reject) => {
          waiting.push(() => network.fetch(request).then(resolve, reject));
        })
      : network.fetch(request);
  const release = async () => {
    while (waiting.length) waiting.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 1));
  };
  return { fetch, release, waiting };
}

test("SAVE_FILES during SAVE_ALL shares its downloads: each font is fetched once, and the save still completes", async () => {
  const caches = new FakeCaches();
  await active({}, { caches });
  const network = new FakeNetwork(served(TEXTS));
  const gate = gatedFonts(network);
  const worker = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: gate.fetch,
    now: () => 2_000,
  });
  const all = worker.saveAll();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const files = worker.saveFiles(BITTER);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await gate.release();
  const [done, reply] = await Promise.all([all, files]);
  assert.equal(done.result, "saved");
  assert.deepEqual(reply, { type: "SAVED_FILES", saved: BITTER, failed: [] });
  for (const path of Object.keys(FONTS)) {
    assert.equal(fetched(network).filter((p) => p === path).length, 1, `${path} is downloaded once`);
  }
});

test("SAVE_ALL after SAVE_FILES skips the fonts already saved", async () => {
  const { worker, network } = await active();
  await worker.saveFiles(BITTER);
  const before = network.requests.length;
  assert.equal((await worker.saveAll()).result, "saved");
  const later = fetched(network).slice(before);
  assert.ok(!later.some((path) => BITTER.includes(path)), "the saved fonts are not downloaded again");
  assert.ok(later.includes("/fonts/inter/inter-roman.woff2"));
});

test("while the saved copy is being removed SAVE_FILES answers busy, and a removal waits for a save in flight", async () => {
  const caches = new FakeCaches();
  await active({}, { caches });
  const network = new FakeNetwork(served(TEXTS));
  const gate = gatedFonts(network);
  const worker = new OfflineWorker(buildOf("b1", TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: gate.fetch,
    now: () => 2_000,
  });
  const files = worker.saveFiles(BITTER);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const removing = worker.removeAll();
  const busy = await worker.saveFiles(["/fonts/inter/inter-roman.woff2"]);
  assert.deepEqual(busy.failed, [{ path: "/fonts/inter/inter-roman.woff2", reason: "busy" }]);
  for (let i = 0; i < 5; i++) await gate.release();
  await files;
  assert.deepEqual(await removing, { type: "REMOVED", removed: true });
  const store = await caches.open(worker.cacheName);
  for (const path of BITTER) {
    assert.ok(
      !(await store.match(`${ORIGIN}${path}`)),
      `${path} saved before the removal ended is removed with the copy`,
    );
  }
});

test("only a top-level tab of the book's origin can send SAVE_FILES: sw.ts checks every message's sender first", () => {
  const page = { type: "window", frameType: "top-level", url: `${ORIGIN}/chapter-1/` };
  assert.ok(fromBookWindow(ORIGIN, { origin: ORIGIN, source: page }));
  assert.ok(!fromBookWindow(ORIGIN, { origin: "https://evil.example", source: page }), "another origin");
  assert.ok(!fromBookWindow(ORIGIN, { origin: ORIGIN, source: { ...page, frameType: "nested" } }), "a framed page");
  const sw = readFileSync(new URL("../src/offline/sw.ts", import.meta.url), "utf8");
  assert.match(
    sw,
    /addEventListener\("message", \(event\) => \{\s*if \(!fromBookWindow\(scope\.location\.origin, event\)\) return;/,
  );
});
