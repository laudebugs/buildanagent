import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { test } from "vitest";
import {
  allowedHosts,
  CACHE_PREFIX,
  NOTICE_TEXT,
  SWITCHED_TEXT,
  saveLandingPage,
  start,
  WORKER_URL,
  watchForUpdate,
} from "../public/scripts/offline.js";
import { CACHE_PREFIX as WORKER_PREFIX } from "../src/offline/worker.js";

// public/scripts/offline.js registers the offline worker only on the host the build names, clears a worker and its
// caches anywhere else, and shows the update notice without ever reloading by itself. It runs here in a happy-dom
// window whose navigator.serviceWorker and caches are fakes that record every call.

class FakeWorker extends EventTarget {
  state = "installing";
  readonly messages: unknown[] = [];
  postMessage(message: unknown) {
    this.messages.push(message);
  }
}

class FakeRegistration extends EventTarget {
  active: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  unregistered = false;
  async unregister() {
    this.unregistered = true;
    return true;
  }
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  readonly registered: { url: string; options: unknown }[] = [];
  readonly registration = new FakeRegistration();
  readonly leftovers = [new FakeRegistration()];
  readonly active = new FakeWorker();
  get ready() {
    return Promise.resolve({ active: this.active });
  }
  async register(url: string, options: unknown) {
    this.registered.push({ url, options });
    return this.registration;
  }
  async getRegistrations() {
    return this.leftovers;
  }
}

function page(url: string, hosts: string | null, withWorker = true) {
  const win = new Window({ url });
  const doc = win.document;
  if (hosts !== null) doc.head.innerHTML = `<meta name="manual-offline-hosts" content="${hosts}">`;
  const container = new FakeContainer();
  if (withWorker) Object.defineProperty(win.navigator, "serviceWorker", { configurable: true, value: container });
  const names = new Set([`${CACHE_PREFIX}old`, `${CACHE_PREFIX}older`, "another-apps-cache"]);
  const caches = { keys: async () => [...names], delete: async (name: string) => names.delete(name) };
  Object.defineProperty(win, "caches", { configurable: true, value: caches });
  let reloads = 0;
  Object.defineProperty(win, "location", {
    configurable: true,
    value: {
      hostname: new URL(url).hostname,
      origin: new URL(url).origin,
      pathname: new URL(url).pathname,
      reload: () => reloads++,
    },
  });
  return { win: win as unknown as globalThis.Window, doc, container, names, reloads: () => reloads };
}

test("the page and the worker agree on the caches' prefix", () => {
  assert.equal(CACHE_PREFIX, WORKER_PREFIX);
});

test("the hosts come from the page's meta tag, and a page without one allows none", () => {
  assert.deepEqual(allowedHosts(page("https://x.test/", "manual.buildanagent.fyi 127.0.0.1").doc as never), [
    "manual.buildanagent.fyi",
    "127.0.0.1",
  ]);
  assert.deepEqual(allowedHosts(page("https://x.test/", null).doc as never), []);
});

test("the production host registers the worker at the root, past the HTTP cache, and clears nothing", async () => {
  const { win, container, names } = page("https://manual.buildanagent.fyi/tools/", "manual.buildanagent.fyi");
  assert.equal(await start(win), "registered");
  assert.deepEqual(container.registered, [{ url: WORKER_URL, options: { scope: "/", updateViaCache: "none" } }]);
  assert.equal(WORKER_URL, "/sw.js");
  assert.ok(!container.leftovers[0]?.unregistered);
  assert.equal(names.size, 3);
});

test("a preview host registers nothing and removes the worker and the book's caches an earlier visit left", async () => {
  const { win, container, names } = page("https://pr-42.manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  assert.equal(await start(win), "cleared");
  assert.deepEqual(container.registered, []);
  assert.ok(container.leftovers[0]?.unregistered);
  assert.deepEqual([...names], ["another-apps-cache"], "only the book's caches go");
});

test("localhost registers nothing in a production build, and only a test build's meta tag lets it", async () => {
  const production = page("http://127.0.0.1:4321/", "manual.buildanagent.fyi");
  assert.equal(await start(production.win), "cleared");
  assert.deepEqual(production.container.registered, []);
  const testBuild = page("http://127.0.0.1:4321/", "manual.buildanagent.fyi 127.0.0.1");
  assert.equal(await start(testBuild.win), "registered");
});

test("a host that only ends with the production host's name registers nothing", async () => {
  for (const url of ["https://manual.buildanagent.fyi.evil.example/", "https://evilmanual.buildanagent.fyi/"]) {
    const { win, container } = page(url, "manual.buildanagent.fyi");
    assert.equal(await start(win), "cleared", url);
    assert.deepEqual(container.registered, []);
  }
});

test("a browser without service workers is left alone, and a refused registration breaks nothing", async () => {
  assert.equal(
    await start(page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi", false).win),
    "unsupported",
  );
  const refused = page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  refused.container.register = async () => {
    throw new DOMException("denied", "SecurityError");
  };
  assert.equal(await start(refused.win), "failed");
  assert.equal(refused.doc.documentElement.dataset.offline, "install-failed", "marked for the save control");
  const preview = page("https://pr-42.manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  preview.container.getRegistrations = async () => {
    throw new DOMException("denied", "SecurityError");
  };
  assert.equal(await start(preview.win), "failed");
  assert.equal(preview.doc.documentElement.dataset.offline, undefined, "a preview never registers, so nothing failed");
});

test("a waiting worker shows the notice, and only a press on Reload asks it to take over and reloads", async () => {
  const { win, doc, container, reloads } = page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  container.controller = new FakeWorker();
  const waiting = new FakeWorker();
  container.registration.waiting = waiting;
  watchForUpdate(win, container.registration as unknown as ServiceWorkerRegistration);
  const notice = doc.querySelector(".update-notice");
  assert.ok(notice, "the notice shows");
  assert.equal(notice.getAttribute("role"), "status");
  assert.equal(notice.querySelector(".update-notice__text")?.textContent, NOTICE_TEXT);
  container.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads(), 0, "another tab's switch does not reload this one");
  assert.deepEqual(waiting.messages, []);
  (notice.querySelector(".update-notice__button") as unknown as HTMLButtonElement).click();
  assert.deepEqual(waiting.messages, [{ type: "SKIP_WAITING" }]);
  assert.equal(reloads(), 0, "no reload until the new worker controls the page");
  container.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads(), 1);
});

test("a worker that installs later shows the notice once, and the first install of all shows none", async () => {
  const first = page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  watchForUpdate(first.win, first.container.registration as unknown as ServiceWorkerRegistration);
  const installing = new FakeWorker();
  first.container.registration.installing = installing;
  first.container.registration.dispatchEvent(new Event("updatefound"));
  installing.state = "installed";
  first.container.registration.waiting = installing;
  installing.dispatchEvent(new Event("statechange"));
  assert.equal(first.doc.querySelector(".update-notice"), null, "no controller yet: this is the first install");

  const later = page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  later.container.controller = new FakeWorker();
  watchForUpdate(later.win, later.container.registration as unknown as ServiceWorkerRegistration);
  const next = new FakeWorker();
  later.container.registration.installing = next;
  later.container.registration.dispatchEvent(new Event("updatefound"));
  next.state = "installed";
  later.container.registration.waiting = next;
  next.dispatchEvent(new Event("statechange"));
  next.dispatchEvent(new Event("statechange"));
  assert.equal(later.doc.querySelectorAll(".update-notice").length, 1);
  (later.doc.querySelector(".update-notice__button--quiet") as unknown as HTMLButtonElement).click();
  assert.equal(later.doc.querySelector(".update-notice"), null, "Not now hides the notice");
  assert.equal(later.reloads(), 0);
});

test("Reload asks the worker waiting at the press, even when a newer build replaced the one that raised the notice", () => {
  const { win, doc, container, reloads } = page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  container.controller = new FakeWorker();
  const b = new FakeWorker();
  container.registration.waiting = b;
  watchForUpdate(win, container.registration as unknown as ServiceWorkerRegistration);
  const c = new FakeWorker();
  container.registration.waiting = c;
  (doc.querySelector(".update-notice__button") as unknown as HTMLButtonElement).click();
  assert.deepEqual(b.messages, [], "the replaced worker is redundant");
  assert.deepEqual(c.messages, [{ type: "SKIP_WAITING" }]);
  container.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads(), 1);
});

test("with no worker waiting any more, Reload reloads at once, and another tab's switch offers a reload", () => {
  const { win, doc, container, reloads } = page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  container.controller = new FakeWorker();
  container.registration.waiting = new FakeWorker();
  watchForUpdate(win, container.registration as unknown as ServiceWorkerRegistration);
  container.registration.waiting = null;
  container.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads(), 0, "another tab's switch does not reload this tab");
  assert.equal(doc.querySelector(".update-notice__text")?.textContent, SWITCHED_TEXT);
  (doc.querySelector(".update-notice__button") as unknown as HTMLButtonElement).click();
  assert.equal(reloads(), 1);
});

test("a worker that fails to install marks the page for the save control and the console", () => {
  const { win, doc, container } = page("https://manual.buildanagent.fyi/", "manual.buildanagent.fyi");
  const warnings: unknown[] = [];
  Object.defineProperty(win, "console", {
    configurable: true,
    value: { warn: (text: unknown) => warnings.push(text) },
  });
  watchForUpdate(win, container.registration as unknown as ServiceWorkerRegistration);
  const installing = new FakeWorker();
  container.registration.installing = installing;
  container.registration.dispatchEvent(new Event("updatefound"));
  installing.state = "redundant";
  installing.dispatchEvent(new Event("statechange"));
  assert.equal(doc.documentElement.dataset.offline, "install-failed");
  assert.equal(warnings.length, 1);
});

test("an uncontrolled page asks the worker to save it and its same-origin files; a controlled page asks nothing", async () => {
  const landing = page("https://manual.buildanagent.fyi/tools/", "manual.buildanagent.fyi");
  Object.defineProperty(landing.win, "performance", {
    configurable: true,
    value: {
      getEntriesByType: () => [
        { name: "https://manual.buildanagent.fyi/scripts/notes.js" },
        { name: "https://manual.buildanagent.fyi/_astro/BaseLayout.abc.css" },
        { name: "https://evil.example/tracker.js" },
        { name: "https://manual.buildanagent.fyi.evil.example/x.js" },
      ],
    },
  });
  assert.equal(await saveLandingPage(landing.win), true);
  assert.deepEqual(landing.container.active.messages, [
    { type: "SAVE_PAGE", paths: ["/tools/", "/scripts/notes.js", "/_astro/BaseLayout.abc.css"] },
  ]);
  const controlled = page("https://manual.buildanagent.fyi/tools/", "manual.buildanagent.fyi");
  controlled.container.controller = new FakeWorker();
  assert.equal(await saveLandingPage(controlled.win), false);
  assert.deepEqual(controlled.container.active.messages, []);
});
