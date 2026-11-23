import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { Window as HappyWindow } from "happy-dom";
import { beforeAll, test } from "vitest";
import {
  chunkPaths,
  filesToSave,
  SAVE_FILES_LIMIT,
  savedAll,
  saveFiles,
  saveFilesInChunks,
} from "../public/scripts/reading-offline.js";
import {
  createTrailing,
  isPlainKey,
  NOTE_SAVED,
  NOTE_UNSAVED,
  nextSize,
  offlineStatus,
  SAVE_DELAY_MS,
  SHEET_QUERY,
  start,
  tabEnds,
} from "../public/scripts/reading-panel.js";
import { pairingOptions, SIZE_NAMES, sizeLabel, sizeOptions } from "../src/components/reading-options.js";
import { pairingFiles, readTokens } from "../src/design/tokens.js";
import { builtBook } from "./built.js";

// The reading settings panel: its pure parts (the step names, the arrow keys on the size steps, the files a pairing
// saves offline), the early script's save(), the panel's markup in a built page, and the panel's script in a happy-dom
// window on that markup. happy-dom has no popover API, so the window gets a small stand-in that fires the same events.
// The browser behaviour (the popover, the sheet, focus, fonts and the offline worker) is scripts/settings-check.mjs.

const tokens = readTokens();
const reading = tokens.font.reading;
const SOURCE = readFileSync(new URL("../public/scripts/reading-settings.js", import.meta.url), "utf8");
const PUBLIC = new URL("../public/", import.meta.url).pathname;
let page = "";

beforeAll(() => {
  page = readFileSync(join(builtBook(), "call-workflow-loop", "index.html"), "utf8");
});

interface Api {
  FONT_KEY: string;
  SIZE_KEY: string;
  DEFAULT_FONT: string;
  DEFAULT_SIZE: number;
  read(storage: unknown): { font: string; size: number };
  save(storage: unknown, settings: unknown): boolean;
}

/** A storage over a map, whose every call can be made to throw. */
function memoryStorage(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return {
    map,
    throws: false,
    getItem(key: string) {
      if (this.throws) throw new Error("storage is off");
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (this.throws) throw new DOMException("full", "QuotaExceededError");
      map.set(key, String(value));
    },
    removeItem(key: string) {
      if (this.throws) throw new Error("storage is off");
      map.delete(key);
    },
  };
}

/** The early script's API, run in a sandbox over a happy-dom document. */
function earlyApi(win: HappyWindow, storage: unknown): Api {
  const context: Record<string, unknown> = { document: win.document, localStorage: storage };
  context.window = context;
  runInContext(SOURCE, createContext(context));
  return context.manualReadingSettings as Api;
}

// ---- The step names and the pure helpers ---------------------------------------------------------------------------

test("each size step has a name, and the panel shows it with its percent", () => {
  assert.deepEqual(
    reading.sizes.map((size) => sizeLabel(size)),
    ["90% · Small", "100% · Default", "115% · Large", "130% · Larger", "150% · Largest"],
  );
  assert.deepEqual(Object.keys(SIZE_NAMES).map(Number), reading.sizes, "every step of book-tokens.json has a name");
  assert.throws(() => sizeLabel(120), /no name/);
  assert.deepEqual(
    sizeOptions(tokens).filter((step) => step.isDefault),
    [{ size: 100, name: "Default", label: "100% · Default", isDefault: true }],
  );
});

test("the arrow keys move one size step without wrapping, and Home and End go to the ends", () => {
  const steps = reading.sizes;
  assert.equal(nextSize(steps, 100, "ArrowRight"), 115);
  assert.equal(nextSize(steps, 100, "ArrowDown"), 115);
  assert.equal(nextSize(steps, 100, "ArrowLeft"), 90);
  assert.equal(nextSize(steps, 100, "ArrowUp"), 90);
  assert.equal(nextSize(steps, 150, "ArrowRight"), 150, "the largest step stays the largest");
  assert.equal(nextSize(steps, 90, "ArrowLeft"), 90, "the smallest step stays the smallest");
  assert.equal(nextSize(steps, 130, "Home"), 90);
  assert.equal(nextSize(steps, 90, "End"), 150);
  assert.equal(nextSize(steps, 100, "Enter"), null);
  assert.equal(nextSize(steps, 100, " "), null);
  assert.equal(nextSize(steps, 101, "ArrowRight"), 100, "an unknown size starts from the smallest");
  assert.equal(nextSize([], 100, "ArrowRight"), null);
});

test("each pairing lists its faces, every file its text can use and their size on disk", () => {
  const options = pairingOptions(tokens, PUBLIC);
  assert.deepEqual(
    options.map((option) => [option.id, option.label, option.faces, option.isDefault]),
    [
      ["book", "Book", "Instrument Serif + Literata", true],
      ["readable", "Readable", "Atkinson Hyperlegible", false],
      ["sans", "Sans", "Space Grotesk + Inter", false],
      ["slab", "Slab", "Bitter", false],
    ],
  );
  for (const option of options) {
    const pairing = reading.pairings.find((entry) => entry.id === option.id);
    assert.ok(pairing);
    assert.deepEqual(option.files, pairingFiles(tokens, pairing));
    const bytes = option.files.reduce((sum, src) => sum + statSync(join(PUBLIC, src)).size, 0);
    assert.equal(option.bytes, bytes);
  }
  assert.deepEqual(options.find((option) => option.id === "readable")?.files, [
    "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-regular.woff2",
    "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-italic.woff2",
    "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-bold.woff2",
  ]);
});

test("the default pairing saves nothing offline, and another saves its own fonts, once each, none dropped", () => {
  assert.deepEqual(filesToSave("book", "book", ["/fonts/literata/literata-roman.woff2"]), []);
  assert.deepEqual(
    filesToSave("slab", "book", ["/fonts/a.woff2", "/fonts/a.woff2", "/scripts/x.js", "/fonts/b.woff2"]),
    ["/fonts/a.woff2", "/fonts/b.woff2"],
  );
  const many = Array.from({ length: 40 }, (_, i) => `/fonts/${i}.woff2`);
  assert.equal(filesToSave("sans", "book", many).length, 40, "a long list is kept whole and sent in chunks");
  assert.deepEqual(
    chunkPaths(many).map((chunk) => chunk.length),
    [16, 16, 8],
  );
  assert.deepEqual(chunkPaths([]), []);
  assert.ok(savedAll({ saved: ["/a", "/b"] }, ["/a", "/b"]));
  assert.ok(!savedAll({ saved: ["/a"] }, ["/a", "/b"]));
  assert.ok(!savedAll(null, ["/a"]));
  assert.ok(!savedAll({ saved: [] }, []));
});

test("the status line names the pairing and the size of its saved fonts", () => {
  assert.equal(offlineStatus("Readable", 60_228), "Readable's fonts are saved for offline reading (about 60 KB).");
});

test("the panel is a sheet on exactly the windows where the header is the phone header", () => {
  const header = readFileSync(new URL("../src/scripts/header.ts", import.meta.url), "utf8");
  assert.equal(/const PHONE = "([^"]+)"/.exec(header)?.[1], SHEET_QUERY);
});

// ---- save() --------------------------------------------------------------------------------------------------------

test("save() writes a choice, deletes the key of a default, and read() gives back what it saved", () => {
  const win = new HappyWindow({ url: "https://manual.buildanagent.fyi/" });
  const storage = memoryStorage();
  const api = earlyApi(win, storage);
  assert.equal(api.save(storage, { font: "sans", size: 130 }), true);
  assert.deepEqual(Object.fromEntries(storage.map), { "manual-reading-font": "sans", "manual-reading-size": "130" });
  assert.deepEqual({ ...api.read(storage) }, { font: "sans", size: 130 });
  assert.equal(api.save(storage, { font: "book", size: 100 }), true);
  assert.deepEqual(Object.fromEntries(storage.map), {}, "the defaults are stored as no key at all");
  assert.deepEqual({ ...api.read(storage) }, { font: "book", size: 100 });
  api.save(storage, { font: "slab", size: 100 });
  assert.deepEqual(Object.fromEntries(storage.map), { "manual-reading-font": "slab" });
});

test("save() stores only allowed values: anything else is stored as the default, which is no key", () => {
  const win = new HappyWindow({ url: "https://manual.buildanagent.fyi/" });
  const storage = memoryStorage({ "manual-reading-font": "slab", "manual-reading-size": "90" });
  const api = earlyApi(win, storage);
  api.save(storage, { font: "__proto__", size: 120 });
  assert.deepEqual(Object.fromEntries(storage.map), {});
  api.save(storage, { font: "Sans", size: "115" });
  assert.deepEqual(Object.fromEntries(storage.map), { "manual-reading-size": "115" }, "a size as a string is fine");
  api.save(storage, null);
  assert.deepEqual(Object.fromEntries(storage.map), {});
});

test("save() swallows a storage that is missing or throws, and says it did not save", () => {
  const win = new HappyWindow({ url: "https://manual.buildanagent.fyi/" });
  const storage = memoryStorage();
  const api = earlyApi(win, storage);
  storage.throws = true;
  assert.equal(api.save(storage, { font: "sans", size: 130 }), false);
  assert.equal(api.save(null, { font: "sans", size: 130 }), false);
  assert.equal(api.save(undefined, { font: "sans", size: 130 }), false);
});

test("the early script's start-up never writes: save() is only defined there, never called", () => {
  const startUp = SOURCE.slice(SOURCE.indexOf("window.manualReadingSettings = "));
  assert.doesNotMatch(startUp, /\bsave\(|setItem|removeItem/);
  assert.match(SOURCE, /window\.manualReadingSettings = Object\.freeze\(\{[\s\S]*?\bsave,\s*\}\)/);
});

// ---- The markup in a built page ------------------------------------------------------------------------------------

/** The header of the built chapter page. */
const headerHtml = () => /<header class="site-header"[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";

test("the header's settings slot holds the Aa button, hidden until the script runs, named and wired to the panel", () => {
  const win = new HappyWindow({ url: "https://manual.buildanagent.fyi/" });
  win.document.body.innerHTML = headerHtml();
  const doc = win.document as unknown as Document;
  const slot = doc.querySelector("[data-slot='settings']");
  const button = slot?.querySelector("[data-reading-button]");
  assert.ok(button, "the button is in the settings slot");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.getAttribute("aria-label"), "Reading settings");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-controls"), "reading-panel");
  assert.equal(button.getAttribute("popovertarget"), "reading-panel");
  assert.ok(button.hasAttribute("hidden"), "without JavaScript the button stays hidden");
  const svg = button.querySelector("svg");
  assert.equal(svg?.getAttribute("aria-hidden"), "true");
  assert.equal(svg?.getAttribute("stroke"), "currentColor");
  const panel = slot?.querySelector("#reading-panel");
  assert.ok(panel, "the panel follows the button in the slot");
  assert.equal(panel.getAttribute("popover"), "auto");
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.equal(panel.hasAttribute("aria-modal"), false, "only the phone sheet is modal, which the script sets");
  assert.ok(panel.hasAttribute("hidden"));
  assert.equal(doc.getElementById(panel.getAttribute("aria-labelledby") ?? "")?.textContent?.trim(), "Reading");
});

test("the panel lists the four pairings and five size steps of book-tokens.json, with their names and files", () => {
  const win = new HappyWindow({ url: "https://manual.buildanagent.fyi/" });
  win.document.body.innerHTML = headerHtml();
  const doc = win.document as unknown as Document;
  const panel = doc.querySelector("#reading-panel");
  assert.ok(panel);
  const legends = [...panel.querySelectorAll("legend")].map((legend) => legend.textContent?.trim());
  assert.deepEqual(legends, ["Typeface pairing", "Text size"]);
  const fonts = [...panel.querySelectorAll<HTMLInputElement>("input[name='reading-font']")];
  assert.deepEqual(
    fonts.map((input) => input.value),
    reading.pairings.map((pairing) => pairing.id),
  );
  assert.deepEqual(
    fonts.filter((input) => input.hasAttribute("checked")).map((input) => input.value),
    [reading.default],
  );
  for (const input of fonts) {
    const pairing = reading.pairings.find((entry) => entry.id === input.value);
    assert.ok(pairing);
    const row = input.closest("label");
    assert.equal(row?.querySelector(".reading-panel__name")?.textContent?.trim(), pairing.label);
    const sample = row?.querySelector("[data-reading-sample]");
    assert.equal(sample?.getAttribute("data-reading-sample"), pairing.id);
    assert.equal(sample?.textContent?.trim(), "Aa");
    assert.equal(sample?.getAttribute("aria-hidden"), "true");
    assert.equal(input.getAttribute("data-files"), pairingFiles(tokens, pairing).join(" "));
  }
  const sizes = [...panel.querySelectorAll<HTMLInputElement>("input[name='reading-size']")];
  assert.deepEqual(
    sizes.map((input) => Number(input.value)),
    reading.sizes,
  );
  assert.deepEqual(
    sizes.map((input) => input.closest("label")?.textContent?.trim()),
    ["90%, Small", "100%, Default", "115%, Large", "130%, Larger", "150%, Largest"],
  );
  assert.equal(panel.querySelector("[data-reading-size-label]")?.textContent?.trim(), "100% · Default");
  assert.equal(panel.querySelector("[data-reading-reset]")?.textContent?.trim(), "Reset");
  assert.equal(panel.querySelector(".reading-panel__note")?.textContent?.trim(), "Saved on this device");
  assert.equal(panel.querySelector("[data-reading-close]")?.getAttribute("aria-label"), "Close");
  assert.equal(panel.querySelector("[data-reading-status]")?.getAttribute("role"), "status");
});

test("each pairing's Aa sample is drawn in its heading face and weight, whatever pairing the page is in", () => {
  const css = readFileSync(new URL("../src/styles/reading.css", import.meta.url), "utf8");
  for (const pairing of reading.pairings) {
    const display = pairing.display === "display" ? tokens.font.display : reading.faces[pairing.display];
    assert.ok(display);
    const rule = new RegExp(
      `\\[data-reading-sample="${pairing.id}"\\] \\{\\s*font-family: "${display.cssFamily}"[^;]*;\\s*font-weight: ${pairing.displayWeight};`,
    );
    assert.match(css, rule, pairing.id);
  }
});

test("the layout loads the panel's script as a same-origin module and its stylesheet with the rest", () => {
  assert.match(page, /<script type="module" src="\/scripts\/reading-panel\.js"><\/script>/);
  // reading-panel.js imports these two; the shell holds only what a page links, so the layout links both.
  assert.match(page, /<link rel="modulepreload" href="\/scripts\/reading-offline\.js">/);
  assert.match(page, /<script type="module" src="\/scripts\/save-offline\.js"><\/script>/);
  const panelSource = readFileSync(new URL("../public/scripts/reading-panel.js", import.meta.url), "utf8");
  assert.deepEqual(
    [...panelSource.matchAll(/^import .* from "\.\/([\w-]+\.js)";$/gm)].map((match) => match[1]).sort(),
    ["reading-offline.js", "save-offline.js"],
  );
  const css = readFileSync(new URL("../src/styles/reading-panel.css", import.meta.url), "utf8");
  assert.match(css, /font-size: calc\(1rem \/ var\(--reading-scale\)\);/, "the panel keeps its size at every step");
  assert.match(css, /\.reading-panel\[data-sheet\]::backdrop/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  const reduced = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  assert.ok(reduced > 0 && !/transition:/.test(css.slice(0, reduced)), "the sheet moves only without reduced motion");
});

// ---- The script in a happy-dom window ------------------------------------------------------------------------------

/** A happy-dom window with the built header, the early script's API and a stand-in for the popover API. */
function panelWindow(values: Record<string, string> = {}, sheet = false) {
  const win = new HappyWindow({ url: "https://manual.buildanagent.fyi/call-workflow-loop/" });
  const doc = win.document;
  doc.body.innerHTML = `${headerHtml()}<main><p>Text</p></main>`;
  const storage = memoryStorage(values);
  Object.defineProperty(win, "localStorage", { value: storage, configurable: true });
  const api = earlyApi(win, storage);
  (win as unknown as { manualReadingSettings: Api }).manualReadingSettings = api;
  // happy-dom has no MessageChannel; Node's carries the worker's answer the same way.
  (win as unknown as { MessageChannel: unknown }).MessageChannel = MessageChannel;
  (win as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: query === SHEET_QUERY ? sheet : false,
    addEventListener() {},
  });
  const panel = doc.querySelector("#reading-panel") as unknown as HTMLElement & { open?: boolean };
  const fire = (type: string, newState: string) => {
    const event = new win.Event(type) as unknown as { newState: string };
    event.newState = newState;
    panel.dispatchEvent(event as unknown as Event);
  };
  Object.assign(panel, {
    showPopover() {
      fire("beforetoggle", "open");
      panel.open = true;
      fire("toggle", "open");
    },
    hidePopover() {
      panel.open = false;
      fire("toggle", "closed");
    },
  });
  const realMatches = panel.matches.bind(panel);
  Object.assign(panel, {
    matches: (selector: string) => (selector === ":popover-open" ? Boolean(panel.open) : realMatches(selector)),
  });
  const button = doc.querySelector("[data-reading-button]") as unknown as HTMLButtonElement;
  return { win, doc: doc as unknown as Document, storage, panel, button, root: doc.documentElement };
}

const input = (doc: unknown, name: string, value: string) =>
  (doc as Document).querySelector<HTMLInputElement>(`input[name='${name}'][value='${value}']`) as HTMLInputElement;

function pick(doc: unknown, name: string, value: string) {
  const radio = input(doc, name, value);
  radio.checked = true;
  radio.dispatchEvent(new (radio.ownerDocument.defaultView as unknown as typeof globalThis).Event("change"));
}

test("without the early script's API or the popover API the button stays hidden", () => {
  const { win, button, panel } = panelWindow();
  delete (win as unknown as { manualReadingSettings?: Api }).manualReadingSettings;
  assert.equal(start(win as unknown as globalThis.Window), null);
  assert.ok(button.hidden);
  const second = panelWindow();
  Object.assign(second.panel, { showPopover: undefined });
  assert.equal(start(second.win as unknown as globalThis.Window), null);
  assert.ok(second.button.hidden && panel.hidden);
});

test("the script shows the button, checks the stored choice and labels its size", () => {
  const { win, doc, button, panel } = panelWindow({ "manual-reading-font": "slab", "manual-reading-size": "130" });
  assert.ok(start(win as unknown as globalThis.Window));
  assert.equal(button.hidden, false);
  assert.equal(panel.hidden, false, "the popover itself stays closed until the button opens it");
  assert.ok(input(doc, "reading-font", "slab").checked);
  assert.ok(input(doc, "reading-size", "130").checked);
  assert.equal(doc.querySelector("[data-reading-size-label]")?.textContent, "130% · Larger");
});

test("choosing a pairing or a size applies it to <html> at once and saves it; Reset restores and clears both", () => {
  const { win, doc, root, storage } = panelWindow();
  start(win as unknown as globalThis.Window);
  pick(doc, "reading-font", "readable");
  assert.equal(root.getAttribute("data-reading-font"), "readable");
  assert.equal(storage.map.get("manual-reading-font"), "readable");
  pick(doc, "reading-size", "150");
  assert.equal(root.getAttribute("data-reading-size"), "150");
  assert.equal(storage.map.get("manual-reading-size"), "150");
  assert.equal(doc.querySelector("[data-reading-size-label]")?.textContent, "150% · Largest");
  (doc.querySelector("[data-reading-reset]") as unknown as HTMLButtonElement).click();
  assert.equal(root.hasAttribute("data-reading-font"), false);
  assert.equal(root.hasAttribute("data-reading-size"), false);
  assert.equal(storage.map.size, 0, "Reset leaves nothing stored");
  assert.ok(input(doc, "reading-font", "book").checked);
  assert.ok(input(doc, "reading-size", "100").checked);
  assert.equal(doc.querySelector("[data-reading-size-label]")?.textContent, "100% · Default");
});

test("the arrow keys on a size step choose the next step and stop at the ends", () => {
  const { win, doc, root } = panelWindow({ "manual-reading-size": "130" });
  start(win as unknown as globalThis.Window);
  const key = (value: string, name: string) => {
    const event = new win.KeyboardEvent("keydown", { key: name, cancelable: true });
    input(doc, "reading-size", value).dispatchEvent(event as unknown as Event);
    return event.defaultPrevented;
  };
  assert.ok(key("130", "ArrowRight"));
  assert.equal(root.getAttribute("data-reading-size"), "150");
  assert.ok(key("150", "ArrowRight"), "the key is still taken, so the browser's radio group does not wrap");
  assert.equal(root.getAttribute("data-reading-size"), "150");
  assert.ok(key("150", "Home"));
  assert.equal(root.getAttribute("data-reading-size"), "90");
  assert.equal(key("90", "Tab"), false, "Tab is left to the browser");
});

test("opening focuses the checked pairing and sets aria-expanded; Escape and Close return focus to the button", () => {
  const { win, doc, panel, button } = panelWindow({ "manual-reading-font": "sans" });
  start(win as unknown as globalThis.Window);
  panel.showPopover();
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement, input(doc, "reading-font", "sans"));
  assert.equal(panel.hasAttribute("data-sheet"), false);
  assert.equal(panel.hasAttribute("aria-modal"), false, "the desktop popover is not modal");
  assert.match(panel.style.top, /^\d+px$/);
  panel.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  panel.hidePopover();
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, button);
  panel.showPopover();
  (doc.querySelector("[data-reading-close]") as unknown as HTMLButtonElement).click();
  assert.equal(panel.open, false);
  assert.equal(doc.activeElement, button);
});

test("on a phone the panel is a modal sheet that keeps Tab inside it", () => {
  const { win, doc, panel } = panelWindow({}, true);
  start(win as unknown as globalThis.Window);
  panel.showPopover();
  assert.ok(panel.hasAttribute("data-sheet"));
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.equal(panel.style.top, "", "a sheet is placed by its stylesheet, not under the button");
  const [first, last] = tabEnds(panel);
  assert.ok(first === doc.querySelector("[data-reading-close]"), "the first tab stop is Close");
  assert.ok(last === doc.querySelector("[data-reading-reset]"), "the last tab stop is Reset");
  last?.focus();
  const tab = new win.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  last?.dispatchEvent(tab as unknown as Event);
  assert.ok(tab.defaultPrevented);
  assert.equal(doc.activeElement, first);
  const back = new win.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  first?.dispatchEvent(back as unknown as Event);
  assert.equal(doc.activeElement, last);
});

test("another tab's change is followed here, through the storage event", () => {
  const { win, root, storage } = panelWindow();
  start(win as unknown as globalThis.Window);
  storage.map.set("manual-reading-font", "slab");
  win.dispatchEvent(new win.StorageEvent("storage", { key: "manual-reading-font" }));
  assert.equal(root.getAttribute("data-reading-font"), "slab");
});

/** A service worker controller that answers SAVE_FILES on the message's port with `answer`. */
function controller(answer: (paths: string[]) => unknown) {
  const sent: { type: string; paths: string[] }[] = [];
  return {
    sent,
    postMessage(message: { type: string; paths: string[] }, ports: { postMessage(data: unknown): void }[]) {
      sent.push(message);
      const data = answer(message.paths);
      if (data !== undefined) queueMicrotask(() => ports[0]?.postMessage(data));
    },
  };
}

test("picking a pairing asks the worker to save its fonts and says so once every file is saved", async () => {
  const { win, doc, panel } = panelWindow();
  const worker = controller((paths) => ({ type: "SAVED_FILES", saved: paths, failed: [] }));
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: worker }, configurable: true });
  start(win as unknown as globalThis.Window);
  assert.equal(worker.sent.length, 0, "the default pairing saves nothing: the shell holds its fonts");
  pick(doc, "reading-font", "readable");
  (panel as unknown as { hidePopover(): void }).hidePopover();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(worker.sent, [
    { type: "SAVE_FILES", paths: input(doc, "reading-font", "readable").dataset.files?.split(" ") ?? [] },
  ]);
  assert.match(
    doc.querySelector("[data-reading-status]")?.textContent ?? "",
    /^Readable's fonts are saved for offline reading \(about \d+ KB\)\.$/,
  );
  pick(doc, "reading-font", "book");
  assert.equal(doc.querySelector("[data-reading-status]")?.textContent, "");
  assert.equal(worker.sent.length, 1);
});

test("a page that loads with a stored pairing saves its fonts; a partial answer or no worker says nothing", async () => {
  const stored = panelWindow({ "manual-reading-font": "sans" });
  const worker = controller((paths) => ({ type: "SAVED_FILES", saved: paths.slice(1), failed: [] }));
  Object.defineProperty(stored.win.navigator, "serviceWorker", { value: { controller: worker }, configurable: true });
  start(stored.win as unknown as globalThis.Window);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(worker.sent.length, 1);
  assert.equal(stored.doc.querySelector("[data-reading-status]")?.textContent, "", "not every file was saved");

  const none = panelWindow({ "manual-reading-font": "sans" });
  Object.defineProperty(none.win.navigator, "serviceWorker", { value: { controller: null }, configurable: true });
  start(none.win as unknown as globalThis.Window);
  assert.equal(await saveFiles(none.win as unknown as globalThis.Window, ["/fonts/a.woff2"]), null);
});

test("saveFiles gives up after its timeout and ignores an answer that is not SAVED_FILES", async () => {
  const { win } = panelWindow();
  const silent = controller(() => undefined);
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: silent }, configurable: true });
  assert.equal(await saveFiles(win as unknown as globalThis.Window, ["/fonts/a.woff2"], 5), null);
  const wrong = controller(() => ({ type: "SAVED", saved: [], failed: [] }));
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: wrong }, configurable: true });
  assert.equal(await saveFiles(win as unknown as globalThis.Window, ["/fonts/a.woff2"]), null);
  assert.equal(await saveFiles(win as unknown as globalThis.Window, []), null, "nothing to save sends nothing");
});

test("the trailing scheduler runs its task once after the delay, restarts on each call and flushes at once", () => {
  const timers = new Map<number, { handler: () => void; delay: number }>();
  let next = 1;
  const setTimer = (handler: () => void, delay: number) => {
    timers.set(next, { handler, delay });
    return next++;
  };
  const clearTimer = (handle: unknown) => void timers.delete(handle as number);
  let runs = 0;
  const trailing = createTrailing(setTimer, clearTimer, () => runs++, 600);
  trailing.flush();
  assert.equal(runs, 0, "nothing pending, nothing to flush");
  trailing.schedule();
  trailing.schedule();
  trailing.schedule();
  assert.equal(timers.size, 1, "each call replaces the pending timer");
  assert.equal([...timers.values()][0]?.delay, 600);
  const [id, pending] = [...timers.entries()][0] as [number, { handler: () => void }];
  timers.delete(id);
  pending.handler();
  assert.equal(runs, 1);
  trailing.schedule();
  trailing.flush();
  assert.equal(runs, 2);
  assert.equal(timers.size, 0, "a flush cancels the timer");
  trailing.flush();
  assert.equal(runs, 2);
});

test("arrowing through the typefaces saves only the pairing the reader stops on, after a pause or when the panel closes", async () => {
  const { win, doc, panel } = panelWindow();
  const worker = controller((paths) => ({ type: "SAVED_FILES", saved: paths, failed: [] }));
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: worker }, configurable: true });
  start(win as unknown as globalThis.Window);
  pick(doc, "reading-font", "readable");
  pick(doc, "reading-font", "sans");
  pick(doc, "reading-font", "slab");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(worker.sent.length, 0, "nothing is sent while the reader is still choosing");
  assert.equal(doc.querySelector("[data-reading-status]")?.textContent, "");
  (panel as unknown as { hidePopover(): void }).hidePopover();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(worker.sent.length, 1, "one message for the last pairing");
  assert.deepEqual(worker.sent[0]?.paths, input(doc, "reading-font", "slab").dataset.files?.split(" "));
  assert.match(doc.querySelector("[data-reading-status]")?.textContent ?? "", /^Slab's fonts are saved/);
  assert.ok(SAVE_DELAY_MS >= 300 && SAVE_DELAY_MS <= 1000);
});

test("a pause after the last choice saves it without the panel closing", async () => {
  const { win, doc } = panelWindow();
  const worker = controller((paths) => ({ type: "SAVED_FILES", saved: paths, failed: [] }));
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: worker }, configurable: true });
  start(win as unknown as globalThis.Window);
  pick(doc, "reading-font", "sans");
  await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS + 200));
  assert.equal(worker.sent.length, 1);
});

test("the note says so when storage refuses a choice, and says it is saved again once a save works", () => {
  const { win, doc, storage } = panelWindow();
  start(win as unknown as globalThis.Window);
  const note = () => doc.querySelector(".reading-panel__note")?.textContent?.trim();
  assert.equal(note(), NOTE_SAVED);
  storage.throws = true;
  pick(doc, "reading-size", "130");
  assert.equal(note(), NOTE_UNSAVED);
  assert.equal(doc.documentElement.getAttribute("data-reading-size"), "130", "the choice still applies to this page");
  storage.throws = false;
  pick(doc, "reading-size", "115");
  assert.equal(note(), NOTE_SAVED);
});

test("a key with Alt, Ctrl or Meta is the browser's: the size steps leave it alone", () => {
  assert.ok(isPlainKey({}));
  assert.ok(isPlainKey({ altKey: false }));
  assert.ok(!isPlainKey({ altKey: true }));
  assert.ok(!isPlainKey({ ctrlKey: true }));
  assert.ok(!isPlainKey({ metaKey: true }));
  const { win, doc } = panelWindow();
  start(win as unknown as globalThis.Window);
  const radio = input(doc, "reading-size", "100");
  const press = (init: Record<string, unknown>) => {
    const event = new win.KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true, bubbles: true, ...init });
    radio.dispatchEvent(event as unknown as Event);
    return event.defaultPrevented;
  };
  assert.equal(press({ altKey: true }), false, "Alt+Left stays Back");
  assert.equal(press({ metaKey: true }), false);
  assert.equal(press({ ctrlKey: true }), false);
  assert.equal(doc.documentElement.getAttribute("data-reading-size"), null, "no step was taken");
  assert.equal(press({}), true, "a plain arrow still moves the step");
  assert.equal(press({ shiftKey: true }), true, "Shift is unchanged");
});

test("a pairing changed in another tab clears the old status and saves the new pairing's fonts", async () => {
  const { win, doc, storage } = panelWindow({ "manual-reading-font": "sans" });
  const worker = controller((paths) => ({ type: "SAVED_FILES", saved: paths, failed: [] }));
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: worker }, configurable: true });
  start(win as unknown as globalThis.Window);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const status = () => doc.querySelector("[data-reading-status]")?.textContent ?? "";
  assert.match(status(), /^Sans's fonts are saved/);
  storage.map.set("manual-reading-font", "slab");
  win.dispatchEvent(new win.StorageEvent("storage", { key: "manual-reading-font" }));
  assert.equal(status(), "", "the old pairing's status is gone");
  await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS + 200));
  assert.equal(worker.sent.length, 2);
  assert.deepEqual(worker.sent[1]?.paths, input(doc, "reading-font", "slab").dataset.files?.split(" "));
  assert.match(status(), /^Slab's fonts are saved/);
});

test("a pairing with more files than one message may carry is sent in chunks and is saved only when every chunk is", async () => {
  const { win } = panelWindow();
  const paths = Array.from({ length: 18 }, (_, i) => `/fonts/f${i}.woff2`);
  const worker = controller((asked) => ({ type: "SAVED_FILES", saved: asked, failed: [] }));
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: worker }, configurable: true });
  const answer = await saveFilesInChunks(win as unknown as globalThis.Window, paths);
  assert.deepEqual(
    worker.sent.map((message) => message.paths.length),
    [SAVE_FILES_LIMIT, 2],
  );
  assert.ok(savedAll(answer, paths));
  const partial = controller((asked) => ({
    type: "SAVED_FILES",
    saved: asked.length === SAVE_FILES_LIMIT ? asked : [],
    failed: [],
  }));
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: partial }, configurable: true });
  assert.ok(!savedAll(await saveFilesInChunks(win as unknown as globalThis.Window, paths), paths));
  const silentSecond = controller((asked) =>
    asked.length === SAVE_FILES_LIMIT ? { type: "SAVED_FILES", saved: asked, failed: [] } : undefined,
  );
  Object.defineProperty(win.navigator, "serviceWorker", { value: { controller: silentSecond }, configurable: true });
  assert.equal(await saveFilesInChunks(win as unknown as globalThis.Window, paths, 5), null);
  assert.equal(await saveFilesInChunks(win as unknown as globalThis.Window, []), null);
});

test("with no usable storage the note says so from the first paint, before any choice", () => {
  const { win, doc } = panelWindow();
  Object.defineProperty(win, "localStorage", { get: () => null, configurable: true });
  start(win as unknown as globalThis.Window);
  assert.equal(doc.querySelector(".reading-panel__note")?.textContent?.trim(), NOTE_UNSAVED);
  const ok = panelWindow();
  start(ok.win as unknown as globalThis.Window);
  assert.equal(ok.doc.querySelector(".reading-panel__note")?.textContent?.trim(), NOTE_SAVED);
});

test("a storage event from another storage area is ignored", () => {
  const { win, root, storage } = panelWindow();
  start(win as unknown as globalThis.Window);
  storage.map.set("manual-reading-font", "slab");
  win.dispatchEvent(new win.StorageEvent("storage", { key: "manual-reading-font", storageArea: {} as never }));
  assert.equal(root.getAttribute("data-reading-font"), null, "a sessionStorage event changes nothing");
  win.dispatchEvent(new win.StorageEvent("storage", { key: "manual-reading-font", storageArea: storage as never }));
  assert.equal(root.getAttribute("data-reading-font"), "slab");
});
