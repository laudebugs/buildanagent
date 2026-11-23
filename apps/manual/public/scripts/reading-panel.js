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
import { filesToSave, savedAll, saveFiles } from "./reading-offline.js";
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
    if (status) status.textContent = "";
    const font = settings.font;
    const input = fontInput(font);
    const paths = filesToSave(font, api.DEFAULT_FONT, (input?.dataset.files ?? "").split(" ").filter(Boolean));
    if (paths.length === 0) return;
    const answer = await saveFiles(win, paths);
    if (settings.font !== font || !status || !savedAll(answer, paths)) return;
    const label = input?.closest("label")?.querySelector(".reading-panel__name")?.textContent?.trim() ?? font;
    status.textContent = offlineStatus(label, Number(input?.dataset.bytes ?? 0));
  };

  const choose = (next) => {
    const changedFont = next.font !== settings.font;
    settings = { font: api.readFont(next.font), size: api.readSize(String(next.size)) };
    api.apply(root, settings);
    api.save(storage, settings);
    sync();
    if (changedFont) saveOffline().catch(() => undefined);
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
    if (event.key !== null && event.key !== api.FONT_KEY && event.key !== api.SIZE_KEY) return;
    const next = api.read(storage);
    if (next.font === settings.font && next.size === settings.size) return;
    settings = next;
    api.apply(root, settings);
    sync();
  });

  sync();
  panel.hidden = false;
  button.hidden = false;
  if (settings.font !== api.DEFAULT_FONT) saveOffline().catch(() => undefined);
  return { settings: () => settings };
}

if (typeof window !== "undefined" && typeof document !== "undefined") start(window);
