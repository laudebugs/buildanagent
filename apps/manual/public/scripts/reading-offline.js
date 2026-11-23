// Saves a reading pairing's fonts for offline use (ADR 0059's SAVE_FILES). The offline shell holds the default pairing's
// fonts only, so a reader who picks Readable, Sans or Slab would see a fallback face offline. When a service worker
// controls the page, the settings panel (reading-panel.js) asks it to save the chosen pairing's files: once when a page
// loads with a stored non-default pairing, and again whenever the reader picks one. The worker saves only files on its
// build's list under /fonts/, checked byte for byte, so this module cannot make it store anything else.
//
// The file is served as-is from public/, not bundled, and the tests import its functions.

/** How long the panel waits for the worker's answer, in milliseconds, before it treats the save as failed. */
export const SAVE_TIMEOUT_MS = 30000;

/** The most paths one SAVE_FILES message may carry, as in src/offline/worker.ts; a test keeps the two equal. */
export const SAVE_FILES_LIMIT = 16;

/**
 * The font files to save for a pairing: none for the default pairing, whose files the shell already holds, and
 * otherwise the pairing's own files that are under /fonts/, without repeats, at most SAVE_FILES_LIMIT of them.
 * @param {string} id the pairing's id
 * @param {string} defaultId the default pairing's id
 * @param {readonly string[]} files every file the pairing can use
 * @returns {string[]}
 */
export function filesToSave(id, defaultId, files) {
  if (id === defaultId) return [];
  const paths = files.filter((path) => typeof path === "string" && path.startsWith("/fonts/"));
  return [...new Set(paths)].slice(0, SAVE_FILES_LIMIT);
}

/**
 * Asks the worker that controls the page to save `paths`, and resolves with its SAVED_FILES answer, or with null when
 * no worker controls the page, there is nothing to save, the answer is not one, or none comes within the timeout.
 * @param {Window} win
 * @param {readonly string[]} paths
 * @param {number} [timeout]
 * @returns {Promise<{ saved: string[], failed: { path: string, reason: string }[] } | null>}
 */
export function saveFiles(win, paths, timeout = SAVE_TIMEOUT_MS) {
  const controller = win.navigator?.serviceWorker?.controller;
  if (!controller || paths.length === 0 || typeof win.MessageChannel !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new win.MessageChannel();
    const timer = win.setTimeout(() => finish(null), timeout);
    function finish(answer) {
      win.clearTimeout(timer);
      channel.port1.close();
      resolve(answer);
    }
    channel.port1.onmessage = (event) => {
      const data = event.data;
      const valid =
        data !== null &&
        typeof data === "object" &&
        data.type === "SAVED_FILES" &&
        Array.isArray(data.saved) &&
        Array.isArray(data.failed);
      finish(valid ? { saved: data.saved, failed: data.failed } : null);
    };
    try {
      controller.postMessage({ type: "SAVE_FILES", paths: [...paths] }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/**
 * Whether an answer saved every path asked for: what the panel needs before it says the pairing is saved for offline.
 * @param {{ saved: readonly string[] } | null} answer
 * @param {readonly string[]} paths
 */
export function savedAll(answer, paths) {
  if (!answer || paths.length === 0) return false;
  const saved = new Set(answer.saved);
  return paths.every((path) => saved.has(path));
}
