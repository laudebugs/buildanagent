// The footer's "Save the manual for offline reading" control (ADR 0059). It asks the offline worker that controls the
// page to save every file of the book (SAVE_ALL), shows the download's progress, the size from the build's
// /offline-manifest.json and the room navigator.storage.estimate() reports, and once saved shows the date and the
// build. It removes the copy again (REMOVE_ALL).
//
// It never downloads or reloads anything by itself: each save starts with the reader's press, and so does a refresh
// of an older copy after an update. What the control shows comes from the worker's STATUS, read when the page loads,
// when it comes back into view and when the connection changes, so a copy the browser evicted shows as not saved. The
// date and build of a saved copy live in the worker's cache beside the files, not in localStorage, so the two can
// never disagree.
//
// Where saving cannot work it says so and offers nothing: a browser without service workers, a host that does not
// register the worker (a preview, or localhost in a production build), storage the browser refuses, a worker that
// failed to install, and a page the worker does not control yet. The file is served as-is from public/, like
// offline.js, and the tests import its functions.
import { allowedHosts } from "./offline.js";

/** How long the control waits for the worker to answer STATUS before it says the worker is not answering. */
export const STATUS_TIMEOUT_MS = 5000;

/** The URL of the build's file list, which the worker never caches. */
export const MANIFEST_URL = "/offline-manifest.json";

const SAFARI_NOTE =
  "Your browser may still clear it when the device needs space, and Safari may clear it if you use Safari for a week without opening the manual.";

/** The reader-facing text for each reason a file was not saved, most telling first. */
export const REASONS = {
  quota: "The browser ran out of room for the manual.",
  "other-build": "A new version of the manual came out during the download. Reload the page, then try again.",
  network: "The connection dropped during the download.",
  storage: "The browser refused to store some files.",
  "different-bytes": "Some files arrived changed on the way, so they were not kept.",
  "no-build-mark": "Some files arrived changed on the way, so they were not kept.",
  "not-storable": "Some files arrived in a form the browser cannot keep.",
};

/**
 * Formats a size in bytes as the reader sees it: "about 600 KB", "about 5 MB", "about 4.2 MB", "about 12 GB".
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "an unknown size";
  if (bytes < 1e3) return "less than 1 KB";
  const units = ["KB", "MB", "GB"];
  const shown = (value) => (value >= 10 ? Math.round(value) : Number(value.toFixed(1)));
  let index = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3) - 1);
  // Rounding can reach the next unit, as 999,600 bytes would read "about 1000 KB", so the unit moves up after it.
  while (index < units.length - 1 && shown(bytes / 1e3 ** (index + 1)) >= 1000) index++;
  return `about ${shown(bytes / 1e3 ** (index + 1))} ${units[index]}`;
}

/**
 * Formats a saved copy's time as a date, such as "23 November 2026".
 * @param {number} at milliseconds since the epoch
 * @returns {string}
 */
export function formatDate(at) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(at));
}

/** The short form of a build id the control shows: its first 8 hex digits. */
export const shortBuild = (build) => String(build).slice(0, 8);

/**
 * @typedef {{
 *   kind: string,
 *   status?: any,
 *   online?: boolean,
 *   total?: { files: number, bytes: number },
 *   room?: number | null,
 *   newer?: boolean,
 *   waiting?: boolean,
 *   result?: any,
 *   progress?: { done: number, total: number, bytes: number, failed: number } | null,
 *   host?: string,
 * }} State
 */

/**
 * @typedef {{
 *   state: string,
 *   detail: string,
 *   primary: { label: string, action: "save" | "cancel" } | null,
 *   remove: boolean,
 *   progress: { percent: number, text: string } | null,
 * }} View
 */

const plural = (count, one, many) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

// The first reason, in REASONS' order, among the files that failed.
function reasonText(failed) {
  const reasons = new Set((failed ?? []).map((problem) => problem.reason));
  if (reasons.size === 0) return "";
  for (const [reason, text] of Object.entries(REASONS)) if (reasons.has(reason)) return text;
  return "";
}

function roomText(total, stored, room) {
  if (room === null || room === undefined || !Number.isFinite(room)) return "";
  const left = Math.max(0, total - stored);
  const text = `This browser has room for ${formatSize(room)} more.`;
  return room < left ? `${text} That may not be enough.` : text;
}

/**
 * Turns what the control knows into what it shows: the state line, the detail, the buttons and the progress bar.
 * @param {State} s
 * @returns {View}
 */
export function view(s) {
  const none = { primary: null, remove: false, progress: null };
  switch (s.kind) {
    case "unsupported":
      return { ...none, state: "This browser can't save the manual for offline reading.", detail: "" };
    case "unavailable":
      return {
        ...none,
        state: "Offline reading is turned off on this copy of the manual.",
        detail: s.host ? `It works on ${s.host}.` : "",
      };
    case "denied":
      return {
        ...none,
        state: "This browser blocks storage for this site, so the manual can't be saved.",
        detail: "",
      };
    case "install-failed":
      return {
        ...none,
        state: "The offline copy could not be set up in this browser.",
        detail: "The manual still reads online.",
      };
    case "not-controlled":
      return { ...none, state: "Reload the page to save the manual for offline reading.", detail: "" };
    case "no-reply":
      return { ...none, state: "The offline copy is not answering. Reload the page to try again.", detail: "" };
    default:
      return statusView(s);
  }
}

function statusView(s) {
  const status = s.status;
  const total = s.total ?? status.total;
  const size = formatSize(total.bytes);
  const saved = status.saved;
  const savedLine = saved ? `Saved on ${formatDate(saved.at)}, version ${shortBuild(saved.build)}.` : "";
  if (s.online === false) {
    if (saved) {
      return {
        state: "You are offline. The saved pages are available.",
        detail: savedLine,
        primary: null,
        remove: true,
        progress: null,
      };
    }
    return {
      state: "You are offline. The manual is not saved, so only the pages you have opened are available.",
      detail: "",
      primary: null,
      remove: false,
      progress: null,
    };
  }
  const progress = s.progress ?? status.saving;
  if (progress) {
    const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    const text = `${progress.done.toLocaleString("en")} of ${plural(progress.total, "file", "files")}, ${formatSize(progress.bytes)} of ${size}`;
    return {
      state: "Saving the manual for offline reading.",
      detail: text,
      primary: { label: "Cancel", action: "cancel" },
      remove: false,
      progress: { percent, text },
    };
  }
  const update = s.waiting || s.newer;
  if (saved) {
    return {
      state: savedLine,
      detail:
        s.result?.result === "not-removed"
          ? "The browser would not remove the saved copy. Try again."
          : update
            ? "A new version of the manual is ready. Reload the page, then save again to update your copy."
            : `Every page opens without a connection. ${SAFARI_NOTE}`,
      primary: null,
      remove: true,
      progress: null,
    };
  }
  if (update) {
    // A Remove pressed while a new version waits still says it worked.
    const removed = s.result?.result === "removed";
    return {
      state: removed ? "Removed the saved copy." : "A new version of the manual is ready.",
      detail: removed
        ? "A new version of the manual is ready. Reload the page before you save it again."
        : "Reload the page, then save the manual for offline reading.",
      primary: null,
      remove: Boolean(status.partial || status.previous),
      progress: null,
    };
  }
  const room = roomText(total.bytes, status.stored.bytes, s.room);
  const failed = s.result?.failed ?? status.failed;
  // A save whose first record the browser refused leaves no partial record, so its own answer counts too.
  if (status.partial || s.result?.result === "partial" || s.result?.result === "stopped") {
    const reason =
      s.result?.result === "cancelled"
        ? "You stopped the download."
        : s.result?.result === "stopped"
          ? "The download stopped before it finished."
          : (REASONS[s.result?.reason] ?? reasonText(failed));
    return {
      state: `Partly saved: ${status.stored.files.toLocaleString("en")} of ${plural(total.files, "file", "files")}.`,
      detail: [reason, room].filter(Boolean).join(" "),
      primary: { label: "Try again", action: "save" },
      remove: true,
      progress: null,
    };
  }
  if (status.previous) {
    const left = formatSize(Math.max(0, total.bytes - status.stored.bytes));
    return {
      state: `Your saved copy is from an earlier version, dated ${formatDate(status.previous.at)}.`,
      detail: `Save it again to update it: ${left} is left to download.`,
      primary: { label: "Update the saved copy", action: "save" },
      remove: true,
      progress: null,
    };
  }
  const result = s.result?.result;
  const updating = result === "refused" && s.result.reason === "not-active";
  const states = {
    refused: updating
      ? "The offline copy is updating. Reload the page, then save."
      : "The saved copy is being removed. Try again in a moment.",
    removed: "Removed the saved copy.",
    "not-removed": "The browser would not remove the saved copy. Try again.",
  };
  return {
    state: states[result] ?? "Not saved.",
    detail: [`The whole manual is ${size}.`, room].filter(Boolean).join(" "),
    primary: updating ? null : { label: "Save the manual for offline reading", action: "save" },
    remove: false,
    progress: null,
  };
}

/**
 * Sends a message to a worker over its own channel and resolves with the first reply that is not progress; each
 * SAVE_PROGRESS on the way goes to `onProgress`. With `timeout`, resolves to null if no reply comes in time.
 * @param {Window} win
 * @param {ServiceWorker} worker
 * @param {object} message
 * @param {{ onProgress?: (progress: any) => void, timeout?: number }} [options]
 * @returns {Promise<any>}
 */
export function ask(win, worker, message, { onProgress, timeout } = {}) {
  return new Promise((resolve) => {
    const channel = new win.MessageChannel();
    let timer;
    channel.port1.onmessage = (event) => {
      const data = event.data;
      if (data?.type === "SAVE_PROGRESS") {
        onProgress?.(data);
        return;
      }
      if (timer !== undefined) win.clearTimeout(timer);
      channel.port1.close?.();
      resolve(data);
    };
    if (timeout !== undefined) {
      timer = win.setTimeout(() => {
        channel.port1.close?.();
        resolve(null);
      }, timeout);
    }
    worker.postMessage(message, [channel.port2]);
  });
}

/**
 * Reads the build's total from /offline-manifest.json, fetched past every cache, or null offline or for a list that
 * is not the build's shape.
 * @param {Window} win
 * @returns {Promise<{ build: string, total: { files: number, bytes: number } } | null>}
 */
export async function readManifest(win) {
  try {
    const response = await win.fetch(MANIFEST_URL, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    const value = await response.json();
    const { build, total } = value ?? {};
    if (typeof build !== "string" || !Number.isFinite(total?.bytes) || !Number.isFinite(total?.files)) return null;
    return { build, total: { files: total.files, bytes: total.bytes } };
  } catch {
    return null;
  }
}

/**
 * The room the browser reports for this site, in bytes; null when it reports none. Rejects when storage is off.
 * @param {Window} win
 * @returns {Promise<number | null>}
 */
async function readRoom(win) {
  const storage = win.navigator.storage;
  if (!storage?.estimate) return null;
  const { quota, usage } = await storage.estimate();
  return Number.isFinite(quota) && Number.isFinite(usage) ? Math.max(0, quota - usage) : null;
}

// Whether the browser lets this site use the Cache API at all; storage turned off for a site makes it throw.
async function storageAllowed(win) {
  try {
    await win.caches.keys();
    return true;
  } catch {
    return false;
  }
}

/** How long a save may go without progress before the control asks the worker whether it is still saving. */
export const WATCHDOG_MS = 15000;

/** How long the control waits for the worker to answer REMOVE_ALL. */
export const REMOVE_TIMEOUT_MS = 30000;

/**
 * Starts the control in the page's footer: works out what it can do, shows it, and wires the buttons. Resolves to an
 * object the tests drive, or null when the page has no control.
 * @param {Window} win
 * @param {{ statusTimeout?: number, watchdog?: number, removeTimeout?: number }} [options]
 */
export async function mount(
  win,
  { statusTimeout = STATUS_TIMEOUT_MS, watchdog = WATCHDOG_MS, removeTimeout = REMOVE_TIMEOUT_MS } = {},
) {
  const doc = win.document;
  const root = doc.querySelector("[data-save-offline]");
  if (!root) return null;
  const parts = {
    title: root.querySelector(".save-offline__title"),
    state: root.querySelector("[data-save-offline-state]"),
    detail: root.querySelector("[data-save-offline-detail]"),
    progress: root.querySelector("[data-save-offline-progress]"),
    bar: root.querySelector("[data-save-offline-bar]"),
    primary: root.querySelector("[data-save-offline-primary]"),
    remove: root.querySelector("[data-save-offline-remove]"),
    announce: root.querySelector("[data-save-offline-announce]"),
  };
  /** @type {State} */
  let current = { kind: "loading" };
  let lastAnnounced = "";

  const render = (next, announce = false) => {
    current = next;
    const shown = view(next);
    const focused = doc.activeElement;
    parts.state.textContent = shown.state;
    parts.detail.textContent = shown.detail;
    parts.detail.hidden = shown.detail === "";
    parts.primary.hidden = !shown.primary;
    // Cancel stays disabled once pressed; any other button the control shows can be pressed.
    if (shown.primary?.action !== "cancel") parts.primary.disabled = false;
    if (shown.primary) {
      parts.primary.textContent = shown.primary.label;
      parts.primary.dataset.action = shown.primary.action;
    }
    parts.remove.hidden = !shown.remove;
    parts.progress.hidden = !shown.progress;
    if (shown.progress) {
      parts.progress.setAttribute("aria-valuenow", String(shown.progress.percent));
      parts.progress.setAttribute("aria-valuetext", shown.progress.text);
      parts.bar.style.inlineSize = `${shown.progress.percent}%`;
    }
    root.hidden = false;
    root.dataset.state = next.kind === "status" ? stateName(next) : next.kind;
    // Focus moves only when the button that held it has gone, to the button that replaced it or the heading.
    if ((focused === parts.primary || focused === parts.remove) && focused.hidden) {
      const target = [parts.primary, parts.remove].find((button) => !button.hidden) ?? parts.title;
      target.focus();
    }
    // The live region speaks only for a result of the reader's own press or a change of connection, so loading the
    // page or a progress step never makes a screen reader talk.
    if (announce && shown.state !== lastAnnounced) {
      parts.announce.textContent = shown.state;
      lastAnnounced = shown.state;
    }
  };

  const container = win.navigator.serviceWorker;
  if (!container || !win.caches) {
    render({ kind: "unsupported" });
    return { refresh: async () => undefined, state: () => current };
  }
  const hosts = allowedHosts(doc);
  if (!hosts.includes(win.location.hostname)) {
    render({ kind: "unavailable", host: hosts[0] });
    return { refresh: async () => undefined, state: () => current };
  }

  const online = () => win.navigator.onLine !== false;
  let result = null;
  let progress = null;

  // `keep` holds on to the last result for a refresh that follows the reader's own press; any other refresh clears it,
  // so a message such as "Removed the saved copy." never outlives the moment it describes.
  const refresh = async (announce = false, keep = false) => {
    if (!keep) result = null;
    if (!(await storageAllowed(win))) return render({ kind: "denied" }, announce);
    const worker = container.controller;
    // A failed install matters only while no worker controls the page: an older build's worker still saves.
    if (!worker) {
      const failed = doc.documentElement.dataset.offline === "install-failed";
      return render({ kind: failed ? "install-failed" : "not-controlled" }, announce);
    }
    const status = await ask(win, worker, { type: "STATUS" }, { timeout: statusTimeout });
    if (status?.type !== "STATUS") return render({ kind: "no-reply" }, announce);
    const [manifest, room, registration] = await Promise.all([
      online() ? readManifest(win) : Promise.resolve(null),
      readRoom(win).catch(() => null),
      container.getRegistration ? container.getRegistration().catch(() => undefined) : Promise.resolve(undefined),
    ]);
    watch(registration);
    const same = manifest?.build === status.build;
    render(
      {
        kind: "status",
        status,
        online: online(),
        total: same ? manifest.total : status.total,
        room,
        newer: Boolean(manifest) && !same,
        waiting: Boolean(registration?.waiting),
        result,
        progress: status.saving ? null : progress,
      },
      announce,
    );
    // A save that this page did not start, or that a reload interrupted, is joined so its progress shows here.
    if (status.saving && !progress) save(worker);
  };

  const sleep = (ms) => new Promise((resolve) => win.setTimeout(resolve, ms));

  const save = async (worker) => {
    result = null;
    progress = { done: 0, total: 0, bytes: 0, failed: 0, ...(current.status?.saving ?? {}) };
    if (current.kind === "status") render({ ...current, progress }, true);
    let lastStep = Date.now();
    let finished = false;
    const showStep = (step) => {
      lastStep = Date.now();
      progress = step;
      if (current.kind === "status") render({ ...current, progress });
    };
    const asked = ask(win, worker, { type: "SAVE_ALL" }, { onProgress: showStep });
    // A worker the browser stopped mid-save (a time limit, a phone suspending the tab, a crash or an update) never
    // answers, so a save that goes quiet asks STATUS. A worker that reports no save running, or no answer, ends it.
    const stalled = (async () => {
      while (!finished) {
        await sleep(watchdog);
        if (finished || Date.now() - lastStep < watchdog) continue;
        const status = await ask(win, container.controller ?? worker, { type: "STATUS" }, { timeout: statusTimeout });
        if (finished) break;
        if (status?.type === "STATUS" && status.saving) showStep(status.saving);
        else return { type: "SAVE_DONE", result: "stopped", saved: null, failed: [] };
      }
      return new Promise(() => undefined);
    })();
    const done = await Promise.race([asked, stalled]);
    finished = true;
    progress = null;
    result = done;
    await refresh(true, true);
  };

  parts.primary.addEventListener("click", () => {
    const worker = container.controller;
    if (!worker) return;
    if (parts.primary.dataset.action === "cancel") {
      worker.postMessage({ type: "CANCEL_SAVE" });
      parts.primary.disabled = true;
      return;
    }
    save(worker).finally(() => {
      parts.primary.disabled = false;
    });
  });
  parts.remove.addEventListener("click", async () => {
    const worker = container.controller;
    if (!worker) return;
    parts.remove.disabled = true;
    const reply = await ask(win, worker, { type: "REMOVE_ALL" }, { timeout: removeTimeout });
    parts.remove.disabled = false;
    result = { result: reply?.removed ? "removed" : "not-removed" };
    await refresh(true, true);
  });
  let watched = false;
  const watch = (registration) => {
    if (watched || !registration?.addEventListener) return;
    watched = true;
    // A new build that finishes installing changes what Save can do, so the control looks again.
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed") refresh();
      });
    });
  };
  win.addEventListener("online", () => refresh(true));
  win.addEventListener("offline", () => refresh(true));
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "visible" && !progress) refresh();
  });
  container.addEventListener?.("controllerchange", () => refresh());
  // offline.js marks a failed install or registration on the page whenever it happens, which may be after this ran.
  new win.MutationObserver(() => {
    if (!progress) refresh();
  }).observe(doc.documentElement, { attributes: true, attributeFilter: ["data-offline"] });

  await refresh();
  return { refresh, state: () => current };
}

/** The name of a status state, for the control's data-state attribute and the browser check. */
function stateName(s) {
  if (s.online === false) return s.status.saved ? "offline-saved" : "offline-unsaved";
  if (s.progress || s.status.saving) return "saving";
  if (s.status.saved) return "saved";
  if (s.waiting || s.newer) return "update-waiting";
  if (s.status.partial || s.result?.result === "partial" || s.result?.result === "stopped") return "partial";
  if (s.status.previous) return "outdated";
  return "not-saved";
}

if (typeof window !== "undefined" && typeof document !== "undefined") mount(window);
