import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { test } from "vitest";
import { formatDate, formatSize, MANIFEST_URL, mount } from "../public/scripts/save-offline.js";
import { OfflineWorker } from "../src/offline/worker.js";
import { buildOf, FakeCaches, FakeNetwork, ORIGIN, ok } from "./offline-fakes.js";

// The footer's save control (public/scripts/save-offline.js) in a happy-dom window, on the footer's own markup. Its
// worker is the real worker logic (src/offline/worker.ts) over the fake Cache API and fetch, reached through a fake
// service worker container and message channel, so each state below is one the worker can really report.

const footer = readFileSync(new URL("../src/components/SiteFooter.astro", import.meta.url), "utf8");
const MARKUP = /<section class="save-offline"[\s\S]*?<\/section>/.exec(footer)?.[0] ?? "";
const BUILD = "0123456789abcdef";
const NOW = Date.UTC(2026, 10, 23, 12);
const TEXTS: Record<string, string> = {
  "/": `<meta name="manual-build" content="${BUILD}"><h1>Contents</h1>`,
  "/offline/": "<h1>You're offline</h1>",
  "/_astro/BaseLayout.abc.css": "body{}",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`/chapter-${i + 1}/`, `<h1>Chapter ${i + 1}</h1>`])),
};
const SHELL = ["/", "/offline/", "/_astro/BaseLayout.abc.css"];
const FILES = Object.keys(TEXTS).length;
const PRODUCTION = "https://manual.buildanagent.fyi/tools/";
const HOSTS = "manual.buildanagent.fyi";

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: FakePort | null = null;
  postMessage(data: unknown) {
    queueMicrotask(() => this.other?.onmessage?.({ data }));
  }
  close() {}
}

class FakeChannel {
  readonly port1 = new FakePort();
  readonly port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

/** A service worker as a page sees it, whose messages the real worker logic answers on the message's port. */
class PageWorker {
  readonly sent: unknown[] = [];
  readonly logic: OfflineWorker | null;
  constructor(logic: OfflineWorker | null) {
    this.logic = logic;
  }
  postMessage(message: unknown, ports: FakePort[] = []) {
    this.sent.push(message);
    const port = ports[0];
    if (!this.logic) return;
    this.logic
      .handleMessage(message, { post: (progress) => port?.postMessage(progress) })
      .then((outcome) => outcome && port?.postMessage(outcome));
  }
}

async function readyWorker(table: ConstructorParameters<typeof FakeNetwork>[0] = {}, caches = new FakeCaches()) {
  const network = new FakeNetwork({
    ...Object.fromEntries(Object.entries(TEXTS).map(([path, text]) => [path, () => ok(text)])),
    ...table,
  });
  const logic = new OfflineWorker(buildOf(BUILD, TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: network.fetch,
    now: () => NOW,
  });
  await logic.install();
  await logic.activate();
  return { logic, caches, network };
}

interface PageOptions {
  url?: string;
  hosts?: string;
  serviceWorker?: boolean;
  worker?: PageWorker | null;
  online?: boolean;
  room?: number | null;
  manifest?: { build: string; total: { files: number; bytes: number } } | null;
  storage?: "allowed" | "denied";
  waiting?: boolean;
}

function page(options: PageOptions = {}) {
  const url = options.url ?? PRODUCTION;
  const win = new Window({ url });
  const doc = win.document;
  doc.head.innerHTML = `<meta name="manual-offline-hosts" content="${options.hosts ?? HOSTS}">`;
  doc.body.innerHTML = `<footer>${MARKUP}</footer>`;
  const registration = { waiting: options.waiting ? {} : null, addEventListener() {} };
  if (options.serviceWorker !== false) {
    const container = new win.EventTarget() as unknown as Record<string, unknown>;
    Object.assign(container, { controller: options.worker ?? null, getRegistration: async () => registration });
    Object.defineProperty(win.navigator, "serviceWorker", { configurable: true, value: container });
  }
  Object.defineProperty(win, "caches", {
    configurable: true,
    value: {
      keys: async () => {
        if (options.storage === "denied") throw new DOMException("The operation is insecure.", "SecurityError");
        return [];
      },
    },
  });
  Object.defineProperty(win, "MessageChannel", { configurable: true, value: FakeChannel });
  Object.defineProperty(win.navigator, "onLine", { configurable: true, get: () => options.online !== false });
  const room = options.room === undefined ? 1_200_000_000 : options.room;
  Object.defineProperty(win.navigator, "storage", {
    configurable: true,
    value: room === null ? undefined : { estimate: async () => ({ quota: room + 1_000, usage: 1_000 }) },
  });
  const fetched: string[] = [];
  Object.defineProperty(win, "fetch", {
    configurable: true,
    value: async (input: string, init: RequestInit) => {
      fetched.push(`${input} ${init?.cache}`);
      if (options.online === false) throw new TypeError("Failed to fetch");
      const manifest =
        options.manifest === undefined ? { build: BUILD, total: { files: FILES, bytes: 4_955_201 } } : options.manifest;
      if (!manifest) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });
    },
  });
  const q = (selector: string) => doc.querySelector(selector) as unknown as HTMLElement;
  const ui = {
    root: () => q("[data-save-offline]"),
    state: () => q("[data-save-offline-state]").textContent,
    detail: () => q("[data-save-offline-detail]").textContent,
    primary: () => q("[data-save-offline-primary]") as HTMLButtonElement,
    remove: () => q("[data-save-offline-remove]") as HTMLButtonElement,
    progress: () => q("[data-save-offline-progress]"),
    announce: () => q("[data-save-offline-announce]").textContent,
  };
  return { win: win as unknown as globalThis.Window, doc, ui, fetched };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("the footer's control renders hidden with no button showing, so a page without JavaScript shows nothing dead", () => {
  assert.match(MARKUP, /<section class="save-offline"[^>]*\shidden>/);
  assert.match(MARKUP, /role="progressbar"[\s\S]*aria-valuemin="0"[\s\S]*aria-valuemax="100"/);
  assert.match(MARKUP, /role="status"/);
  assert.doesNotMatch(MARKUP, /<input|<textarea|<select/, "the control has no text field");
});

test("sizes read as the reader expects, and a date as day, month and year", () => {
  assert.equal(formatSize(4_955_201), "about 5 MB");
  assert.equal(formatSize(4_250_000), "about 4.3 MB");
  assert.equal(formatSize(12_400_000), "about 12 MB");
  assert.equal(formatSize(640_000), "about 640 KB");
  assert.equal(formatSize(1_234_000_000), "about 1.2 GB");
  assert.equal(formatSize(12), "less than 1 KB");
  assert.equal(formatDate(NOW), "23 November 2026");
});

test("a browser without service workers is told it can't save, and nothing else happens", async () => {
  const { win, ui, fetched } = page({ serviceWorker: false });
  await mount(win);
  assert.equal(ui.root().hidden, false);
  assert.equal(ui.state(), "This browser can't save the manual for offline reading.");
  assert.ok(ui.primary().hidden && ui.remove().hidden);
  assert.deepEqual(fetched, []);
});

test("a preview, and localhost in a production build, say offline reading is off here and ask the worker nothing", async () => {
  for (const url of ["https://pr-42.manual.buildanagent.fyi/", "http://127.0.0.1:4321/"]) {
    const worker = new PageWorker((await readyWorker()).logic);
    const { win, ui } = page({ url, worker });
    await mount(win);
    assert.equal(ui.state(), "Offline reading is turned off on this copy of the manual.", url);
    assert.equal(ui.detail(), "It works on manual.buildanagent.fyi.");
    assert.ok(ui.primary().hidden && ui.remove().hidden);
    assert.deepEqual(worker.sent, [], "no message to the worker");
  }
});

test("storage turned off, a worker that failed to install, an uncontrolled page and a silent worker each say so", async () => {
  const denied = page({ storage: "denied", worker: new PageWorker(null) });
  await mount(denied.win);
  assert.equal(denied.ui.state(), "This browser blocks storage for this site, so the manual can't be saved.");

  const failed = page({ worker: new PageWorker(null) });
  failed.doc.documentElement.dataset.offline = "install-failed";
  await mount(failed.win);
  assert.equal(failed.ui.state(), "The offline copy could not be set up in this browser.");

  const uncontrolled = page({ worker: null });
  await mount(uncontrolled.win);
  assert.equal(uncontrolled.ui.state(), "Reload the page to save the manual for offline reading.");
  assert.ok(uncontrolled.ui.primary().hidden);

  const silent = page({ worker: new PageWorker(null) });
  await mount(silent.win, { statusTimeout: 5 });
  assert.equal(silent.ui.state(), "The offline copy is not answering. Reload the page to try again.");
});

test("not saved: the size comes from the build's list fetched past the cache, the room from the browser's estimate", async () => {
  const worker = new PageWorker((await readyWorker()).logic);
  const { win, ui, fetched } = page({ worker });
  await mount(win);
  assert.equal(ui.state(), "Not saved.");
  assert.equal(ui.detail(), "The whole manual is about 5 MB. This browser has room for about 1.2 GB more.");
  assert.equal(ui.primary().hidden, false);
  assert.equal(ui.primary().textContent, "Save the manual for offline reading");
  assert.ok(ui.remove().hidden);
  assert.deepEqual(fetched, [`${MANIFEST_URL} no-store`]);
  assert.equal(ui.announce(), "", "loading the page says nothing to a screen reader");
  assert.deepEqual(worker.sent, [{ type: "STATUS" }], "the control never saves by itself");

  const tight = page({ worker, room: 2_000_000 });
  await mount(tight.win);
  assert.match(tight.ui.detail(), /room for about 2 MB more\. That may not be enough\.$/);
});

test("saving shows a progress bar with its values, then the saved date and version, and focus follows the press", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { caches } = await readyWorker();
  // The chapters wait until the test releases them, then arrive as the build wrote them.
  const network = new FakeNetwork(
    Object.fromEntries(Object.entries(TEXTS).map(([path, text]) => [path, () => ok(text)])),
  );
  const gated = new OfflineWorker(buildOf(BUILD, TEXTS, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: async (request) => {
      await gate;
      return network.fetch(request);
    },
    now: () => NOW,
  });
  const worker = new PageWorker(gated);
  const { win, ui } = page({ worker });
  await mount(win);
  ui.primary().focus();
  ui.primary().click();
  await settle();
  assert.equal(ui.progress().hidden, false);
  assert.equal(ui.progress().getAttribute("role"), "progressbar");
  assert.equal(ui.progress().getAttribute("aria-valuenow"), String(Math.round((SHELL.length / FILES) * 100)));
  assert.match(ui.progress().getAttribute("aria-valuetext") ?? "", new RegExp(`^${SHELL.length} of ${FILES} files, `));
  assert.equal(ui.primary().textContent, "Cancel");
  assert.equal(ui.announce(), "Saving the manual for offline reading.");
  release();
  await settle();
  assert.equal(ui.progress().hidden, true);
  assert.equal(ui.state(), `Saved on 23 November 2026, version ${BUILD.slice(0, 8)}.`);
  assert.match(ui.detail(), /Every page opens without a connection\./);
  assert.equal(ui.announce(), ui.state(), "the result is announced once");
  assert.ok(ui.primary().hidden);
  assert.equal(ui.remove().hidden, false);
  assert.equal(win.document.activeElement, ui.remove(), "focus moves to Remove only because Cancel went away");
  assert.ok(worker.sent.some((message) => (message as { type: string }).type === "SAVE_ALL"));
});

test("Remove clears the copy and offers Save again; offline, a saved copy says so and an unsaved one says it is not", async () => {
  const { logic } = await readyWorker();
  await logic.saveAll();
  const worker = new PageWorker(logic);
  const offlineSaved = page({ worker, online: false });
  await mount(offlineSaved.win);
  assert.equal(offlineSaved.ui.state(), "You are offline. The saved pages are available.");
  assert.equal(offlineSaved.ui.detail(), `Saved on 23 November 2026, version ${BUILD.slice(0, 8)}.`);

  const { win, ui } = page({ worker });
  await mount(win);
  assert.equal(ui.remove().hidden, false);
  ui.remove().click();
  await settle();
  assert.equal(ui.state(), "Removed the saved copy.");
  assert.equal(ui.announce(), "Removed the saved copy.");
  assert.equal(ui.primary().textContent, "Save the manual for offline reading");
  assert.equal((await logic.status()).saved, null);

  const offlineUnsaved = page({ worker, online: false });
  await mount(offlineUnsaved.win);
  assert.equal(
    offlineUnsaved.ui.state(),
    "You are offline. The manual is not saved, so only the pages you have opened are available.",
  );
  assert.ok(offlineUnsaved.ui.primary().hidden && offlineUnsaved.ui.remove().hidden);
});

test("a refused quota shows a partial save with the reason and Try again, never Saved", async () => {
  const { logic, caches } = await readyWorker();
  let puts = 0;
  (await caches.open(logic.cacheName)).refuse = (key) =>
    key.includes("__manual-offline__") || ++puts <= 3 ? null : new DOMException("Full.", "QuotaExceededError");
  const { win, ui } = page({ worker: new PageWorker(logic) });
  await mount(win);
  ui.primary().click();
  await settle();
  assert.equal(ui.state(), `Partly saved: ${SHELL.length + 3} of ${FILES} files.`);
  assert.match(ui.detail(), /^The browser ran out of room for the manual\./);
  assert.equal(ui.primary().textContent, "Try again");
  assert.equal(ui.remove().hidden, false);
  assert.equal(ui.root().dataset.state, "partial");
});

test("a copy the browser evicted shows as Not saved when the page loads again", async () => {
  const { logic, caches } = await readyWorker();
  await logic.saveAll();
  for (const name of await caches.keys()) await caches.delete(name);
  const { win, ui } = page({ worker: new PageWorker(logic) });
  await mount(win);
  assert.equal(ui.state(), "Not saved.");
  assert.equal(ui.primary().hidden, false);
});

test("with a new build waiting or deployed, the control asks for a Reload before saving and offers no Save", async () => {
  const worker = new PageWorker((await readyWorker()).logic);
  const waiting = page({ worker, waiting: true });
  await mount(waiting.win);
  assert.equal(waiting.ui.state(), "A new version of the manual is ready.");
  assert.ok(waiting.ui.primary().hidden);
  const deployed = page({ worker, manifest: { build: "fedcba9876543210", total: { files: 1, bytes: 1 } } });
  await mount(deployed.win);
  assert.equal(deployed.ui.root().dataset.state, "update-waiting");
});

test("after an update, an older saved copy offers Update the saved copy, with what is left to download", async () => {
  const caches = new FakeCaches();
  const old = await readyWorker({}, caches);
  await old.logic.saveAll();
  const changed = { ...TEXTS, "/chapter-1/": "<h1>Chapter 1, edited</h1>" };
  const next = new OfflineWorker(buildOf("1111111111111111", changed, SHELL), {
    origin: ORIGIN,
    caches,
    fetch: new FakeNetwork(Object.fromEntries(Object.entries(changed).map(([path, text]) => [path, () => ok(text)])))
      .fetch,
    now: () => NOW + 86_400_000,
  });
  await next.install();
  await next.activate();
  const { win, ui } = page({
    worker: new PageWorker(next),
    manifest: { build: "1111111111111111", total: { files: FILES, bytes: 4_955_201 } },
  });
  await mount(win);
  assert.equal(ui.state(), "Your saved copy is from an earlier version, saved on 23 November 2026.");
  assert.equal(ui.primary().textContent, "Update the saved copy");
  ui.primary().click();
  await settle();
  assert.equal(ui.state(), "Saved on 24 November 2026, version 11111111.");
});
