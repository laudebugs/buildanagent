// Registers the book's offline service worker (/sw.js) and tells the reader when a new version is ready (ADR 0059).
//
// The worker registers only on a host the page's <meta name="manual-offline-hosts"> lists, which the build writes from
// the Astro config's `site`: manual.buildanagent.fyi in production. Any other host, such as a preview at
// pr-<n>.manual.buildanagent.fyi, registers nothing and removes a worker and caches that an earlier visit left, so a
// preview never keeps serving an old build of itself.
//
// A new build's worker installs in the background and then waits. The page shows a small notice, and only a press on
// Reload asks the waiting worker to take over and reloads the page; the page never reloads by itself. The file is served
// as-is from public/, not bundled, like reading.js; the page loads it as a module, and the tests import its functions.

/** The prefix of the worker's cache names, as in src/offline/worker.ts; a test keeps the two equal. */
export const CACHE_PREFIX = "manual-";

/** The worker's URL and scope: the site root, so it controls every page of the book. */
export const WORKER_URL = "/sw.js";

/** The reader-facing text of the update notice. */
export const NOTICE_TEXT = "A new version of the manual is ready.";

/**
 * Reads the hosts that may register the worker from the page's meta tag.
 * @param {Document} doc
 * @returns {string[]}
 */
export function allowedHosts(doc) {
  const meta = doc.querySelector('meta[name="manual-offline-hosts"]');
  return (meta?.getAttribute("content") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Unregisters every worker of this origin and deletes the caches it made. Runs on a host that must not keep one.
 * @param {Window} win
 */
export async function clearLeftovers(win) {
  for (const registration of await win.navigator.serviceWorker.getRegistrations()) await registration.unregister();
  if (!win.caches) return;
  for (const name of await win.caches.keys()) {
    if (name.startsWith(CACHE_PREFIX)) await win.caches.delete(name);
  }
}

/**
 * Shows the update notice once; Reload asks `waiting` to take over, and the reload follows when it has.
 * @param {Window} win
 * @param {ServiceWorker} waiting
 * @param {{ reloading: boolean }} state
 */
export function showNotice(win, waiting, state) {
  const doc = win.document;
  if (doc.querySelector(".update-notice")) return;
  const notice = doc.createElement("div");
  notice.className = "update-notice";
  notice.setAttribute("role", "status");
  const text = doc.createElement("p");
  text.className = "update-notice__text";
  text.textContent = NOTICE_TEXT;
  const reload = doc.createElement("button");
  reload.type = "button";
  reload.className = "update-notice__button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => {
    state.reloading = true;
    reload.disabled = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  });
  const later = doc.createElement("button");
  later.type = "button";
  later.className = "update-notice__button update-notice__button--quiet";
  later.textContent = "Not now";
  later.addEventListener("click", () => notice.remove());
  notice.append(text, reload, later);
  doc.body.append(notice);
}

/**
 * Watches a registration for a new build's worker that has installed while an older one controls the page.
 * @param {Window} win
 * @param {ServiceWorkerRegistration} registration
 */
export function watchForUpdate(win, registration) {
  const container = win.navigator.serviceWorker;
  const state = { reloading: false };
  // The reload happens only after the reader pressed Reload, never because another tab's press changed the worker.
  container.addEventListener("controllerchange", () => {
    if (state.reloading) win.location.reload();
  });
  const offer = (worker) => {
    if (worker && container.controller) showNotice(win, worker, state);
  };
  offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed") offer(installing);
    });
  });
}

/**
 * Starts the script: registers the worker on an allowed host, or clears what an earlier visit left on any other.
 * Resolves to what it did, for the tests.
 * @param {Window} win
 * @returns {Promise<"unsupported" | "cleared" | "registered" | "failed">}
 */
export async function start(win) {
  if (!win.navigator.serviceWorker) return "unsupported";
  try {
    if (!allowedHosts(win.document).includes(win.location.hostname)) {
      await clearLeftovers(win);
      return "cleared";
    }
    // updateViaCache "none" makes every update check fetch sw.js from the network, never from the HTTP cache.
    const registration = await win.navigator.serviceWorker.register(WORKER_URL, { scope: "/", updateViaCache: "none" });
    watchForUpdate(win, registration);
    return "registered";
  } catch {
    // Storage can be off or the browser can refuse the worker; the book then reads online as before.
    return "failed";
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") start(window);
