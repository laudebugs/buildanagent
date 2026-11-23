// The header's reading settings panel (design S1, src/components/ReadingSettings.astro): the "Aa" button opens a popover
// under it on a desktop and a bottom sheet on a phone, where the reader picks a typeface pairing and a text size. A
// choice applies at once through window.manualReadingSettings, which public/scripts/reading-settings.js defines in
// <head>, and is saved in localStorage through its save(), so the early script applies it before the next page's first
// paint. When a service worker controls the page, a non-default pairing's fonts are also saved for offline reading
// (reading-offline.js).
//
// The panel is a native popover opened by the button's popovertarget, so the browser closes it on Escape and on a click
// outside, and opening it closes a notes popover, which is a popover of the same kind. On a phone the sheet is modal:
// it says so to assistive technology and keeps Tab inside it. Without the popover API, the early script's API or
// JavaScript, the button stays hidden and the page shows the default pairing and size.
//
// The file is served as-is from public/, not bundled, like notes.js; the page loads it as a module and the tests import
// its functions.
import { filesToSave, savedAll, saveFilesInChunks } from "./reading-offline.js";
import { formatSize } from "./save-offline.js";

/** The windows where the panel is a bottom sheet: the phone header's query (src/scripts/header.ts), kept equal by a test. */
export const SHEET_QUERY = "(max-width: 760px), (pointer: coarse)";

/** The gap, in pixels, between the button and the popover under it, and between the popover and the window's edge. */
const GAP = 6;
const EDGE = 8;

/**
 * The size step a key moves to from `current`: the arrow keys move one step, Right and Down to the larger and Left and
 * Up to the smaller, as they move between radio buttons, and Home and End go to the ends. Unlike a radio group, the
 * steps do not wrap, so the largest size is never one key press from the smallest. Null for any other key.
 * @param {readonly number[]} sizes the steps, smallest first
 * @param {number} current
 * @param {string} key
 * @returns {number | null}
 */
export function nextSize(sizes, current, key) {
  if (sizes.length === 0) return null;
  const at = Math.max(0, sizes.indexOf(current));
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[key];
  if (step !== undefined) return sizes[Math.min(sizes.length - 1, Math.max(0, at + step))] ?? null;
  if (key === "Home") return sizes[0] ?? null;
  if (key === "End") return sizes[sizes.length - 1] ?? null;
  return null;
}

/** How long, in milliseconds, the panel waits after a pairing change before it saves the fonts, so arrowing through the radios saves only the pairing the reader stops on. */
export const SAVE_DELAY_MS = 600;

/** The note under the choices while the settings are stored, and while storage refused them. */
export const NOTE_SAVED = "Saved on this device";
export const NOTE_UNSAVED = "Not saved: this browser blocked storage";

/**
 * A trailing-edge scheduler: `schedule()` restarts a timer that runs `task` once after `delay`, and `flush()` runs it at
 * once when one is pending, so a pending save is not lost when the panel closes.
 * @param {(handler: () => void, delay: number) => unknown} setTimer
 * @param {(handle: unknown) => void} clearTimer
 * @param {() => void} task
 * @param {number} delay
 */
export function createTrailing(setTimer, clearTimer, task, delay) {
  let handle = null;
  const run = () => {
    handle = null;
    task();
  };
  return {
    schedule() {
      if (handle !== null) clearTimer(handle);
      handle = setTimer(run, delay);
    },
    flush() {
      if (handle === null) return;
      clearTimer(handle);
      run();
    },
  };
}

/**
 * Whether a key press is the plain arrow, Home or End the size steps handle: with Alt, Ctrl or Meta held it belongs to
 * the browser (Alt+Left is Back), so the panel leaves it alone. Shift is allowed.
 * @param {{ altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean }} event
 */
export function isPlainKey(event) {
  return !event.altKey && !event.ctrlKey && !event.metaKey;
}

/**
 * The panel's status line once a pairing's fonts are saved for offline reading, with their size.
 * @param {string} label the pairing's name
 * @param {number} bytes
 */
export function offlineStatus(label, bytes) {
  return `${label}'s fonts are saved for offline reading (${formatSize(bytes)}).`;
}

/**
 * The first and last element Tab reaches in the panel: its focusable buttons and, of each radio group, the checked
 * radio, which is the group's one tab stop.
 * @param {Element} panel
 * @returns {[HTMLElement | undefined, HTMLElement | undefined]}
 */
export function tabEnds(panel) {
  const stops = [...panel.querySelectorAll("button, input")].filter(
    (element) => !element.disabled && (element.type !== "radio" || element.checked),
  );
  return [stops[0], stops[stops.length - 1]];
}

/** The key the start-up probe writes and removes at once; it never holds a setting. */
export const PROBE_KEY = "manual-reading-probe";

/**
 * Whether a storage accepts a write: one setItem and one removeItem of a dedicated key. A storage can exist and still
 * refuse every write (a full quota, some private modes), so reading it says nothing about whether a choice will stay.
 * A removeItem that throws after the write worked leaves only that one key behind and does not make the storage
 * unusable, so only the write decides.
 * @param {Storage | null} storage
 */
export function canWrite(storage) {
  if (!storage) return false;
  try {
    storage.setItem(PROBE_KEY, "1");
  } catch {
    return false;
  }
  try {
    storage.removeItem(PROBE_KEY);
  } catch {
    // The write worked, which is what a choice needs.
  }
  return true;
}

/** Reads localStorage, which can be off or throw. */
function storageOf(win) {
  try {
    return win.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts the panel on a page. Returns null, leaving the button hidden, when the page has no panel or the browser lacks
 * what it needs; otherwise returns the current settings' getter, for the tests.
 * @param {Window} win
 */
export function start(win) {
  const doc = win.document;
  const api = win.manualReadingSettings;
  const button = doc.querySelector("[data-reading-button]");
  const panel = doc.querySelector("[data-reading-panel]");
  if (!api || typeof api.save !== "function" || !button || !panel || typeof panel.showPopover !== "function")
    return null;
  const root = doc.documentElement;
  const storage = storageOf(win);
  const fonts = [...panel.querySelectorAll("input[name='reading-font']")];
  const sizes = [...panel.querySelectorAll("input[name='reading-size']")];
  const steps = sizes.map((input) => Number(input.value));
  const sizeLabel = panel.querySelector("[data-reading-size-label]");
  const status = panel.querySelector("[data-reading-status]");
  const note = panel.querySelector(".reading-panel__note");
  const sheetQuery = typeof win.matchMedia === "function" ? win.matchMedia(SHEET_QUERY) : null;
  let settings = api.read(storage);
  let returnFocus = false;

  const fontInput = (id) => fonts.find((input) => input.value === id);
  const sizeInput = (size) => sizes.find((input) => Number(input.value) === size);

  // Checks the radios that match the settings and shows the size's label.
  const sync = () => {
    for (const input of fonts) input.checked = input.value === settings.font;
    for (const input of sizes) input.checked = Number(input.value) === settings.size;
    if (sizeLabel) sizeLabel.textContent = sizeInput(settings.size)?.dataset.label ?? "";
  };

  // Asks the worker to save the pairing's fonts, and says so in the status line once every file is saved. A failure
  // says nothing: the fonts still load from the network, and the save is asked again on the next page.
  const saveOffline = async () => {
    const font = settings.font;
    const input = fontInput(font);
    const paths = filesToSave(font, api.DEFAULT_FONT, (input?.dataset.files ?? "").split(" ").filter(Boolean));
    if (paths.length === 0) return;
    const answer = await saveFilesInChunks(win, paths);
    if (settings.font !== font || !status || !savedAll(answer, paths)) return;
    const label = input?.closest("label")?.querySelector(".reading-panel__name")?.textContent?.trim() ?? font;
    status.textContent = offlineStatus(label, Number(input?.dataset.bytes ?? 0));
  };

  // A font change clears the old pairing's status and waits for the reader to stop before it saves.
  const saveLater = createTrailing(
    (handler, delay) => win.setTimeout(handler, delay),
    (handle) => win.clearTimeout(handle),
    () => void saveOffline().catch(() => undefined),
    SAVE_DELAY_MS,
  );
  const fontChanged = () => {
    if (status) status.textContent = "";
    saveLater.schedule();
  };

  const choose = (next) => {
    const changedFont = next.font !== settings.font;
    settings = { font: api.readFont(next.font), size: api.readSize(String(next.size)) };
    api.apply(root, settings);
    const stored = api.save(storage, settings);
    if (note) note.textContent = stored ? NOTE_SAVED : NOTE_UNSAVED;
    sync();
    if (changedFont) fontChanged();
  };

  for (const input of fonts) {
    input.addEventListener("change", () => {
      if (input.checked) choose({ ...settings, font: input.value });
    });
  }
  for (const input of sizes) {
    input.addEventListener("change", () => {
      if (input.checked) choose({ ...settings, size: Number(input.value) });
    });
    input.addEventListener("keydown", (event) => {
      if (!isPlainKey(event)) return;
      const size = nextSize(steps, settings.size, event.key);
      if (size === null) return;
      event.preventDefault();
      if (size !== settings.size) choose({ ...settings, size });
      sizeInput(size)?.focus();
    });
  }

  panel.querySelector("[data-reading-reset]")?.addEventListener("click", () => {
    choose({ font: api.DEFAULT_FONT, size: api.DEFAULT_SIZE });
  });

  panel.querySelector("[data-reading-close]")?.addEventListener("click", () => {
    returnFocus = true;
    panel.hidePopover();
  });

  const isSheet = () => panel.hasAttribute("data-sheet");

  // The popover hangs under the button, right-aligned with it and kept inside the window.
  const place = () => {
    if (isSheet()) {
      panel.style.top = "";
      panel.style.right = "";
      return;
    }
    const rect = button.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.bottom + GAP)}px`;
    panel.style.right = `${Math.max(EDGE, Math.round(root.clientWidth - rect.right))}px`;
  };

  panel.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    const sheet = Boolean(sheetQuery?.matches);
    panel.toggleAttribute("data-sheet", sheet);
    if (sheet) panel.setAttribute("aria-modal", "true");
    else panel.removeAttribute("aria-modal");
    sync();
    place();
  });

  panel.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    button.setAttribute("aria-expanded", String(open));
    if (!open) saveLater.flush();
    if (open) {
      returnFocus = false;
      (fontInput(settings.font) ?? fonts[0])?.focus();
    } else if (returnFocus) {
      // Escape and Close give focus back to the button; a click outside leaves it where the reader clicked.
      returnFocus = false;
      button.focus();
    }
  });

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      returnFocus = true;
      return;
    }
    if (event.key !== "Tab" || !isSheet()) return;
    // The sheet is modal, so Tab wraps around inside it.
    const [first, last] = tabEnds(panel);
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });

  // Focus that leaves the desktop popover for the page closes it, so it never hangs over text the reader moved on to.
  panel.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (isSheet() || !(next instanceof win.Node) || panel.contains(next) || next === button) return;
    panel.hidePopover();
  });

  win.addEventListener("resize", () => {
    if (panel.matches(":popover-open")) place();
  });
  // A rotation or a resize across the phone width would leave the wrong layout open, so the panel closes.
  sheetQuery?.addEventListener?.("change", () => {
    if (panel.matches(":popover-open")) panel.hidePopover();
  });

  // Another tab of the book changed the settings: this page follows.
  win.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== storage) return;
    if (event.key !== null && event.key !== api.FONT_KEY && event.key !== api.SIZE_KEY) return;
    const next = api.read(storage);
    if (next.font === settings.font && next.size === settings.size) return;
    const changedFont = next.font !== settings.font;
    settings = next;
    api.apply(root, settings);
    sync();
    if (changedFont) fontChanged();
  });

  // Storage that is missing or refuses a write must not be called "Saved" before the first pick.
  if (note && !canWrite(storage)) note.textContent = NOTE_UNSAVED;
  sync();
  panel.hidden = false;
  button.hidden = false;
  if (settings.font !== api.DEFAULT_FONT) saveOffline().catch(() => undefined);
  return { settings: () => settings };
}

if (typeof window !== "undefined" && typeof document !== "undefined") start(window);
