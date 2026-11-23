import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { Window } from "happy-dom";
import { test } from "vitest";
import { pairingFace, pairingPreloads, READING_CSS_URL, readTokens } from "../src/design/tokens.js";

// public/scripts/reading-settings.js is a blocking classic script, so it cannot export: it runs here in a sandbox with
// a happy-dom document and a storage this test controls, and the test reads what it put on <html> and in <head>, and
// the functions it leaves on window.manualReadingSettings.

const SOURCE = readFileSync(new URL("../public/scripts/reading-settings.js", import.meta.url), "utf8");
const tokens = readTokens();
const reading = tokens.font.reading;

interface Api {
  FONT_KEY: string;
  SIZE_KEY: string;
  DEFAULT_FONT: string;
  DEFAULT_SIZE: number;
  PAIRINGS: Record<string, readonly string[]>;
  SIZES: readonly number[];
  readFont(raw: unknown): string;
  readSize(raw: unknown): number;
  read(storage: unknown): { font: string; size: number };
  apply(root: Element, settings: { font: string; size: number }): void;
}

/** A storage holding `values`, or one whose every call throws. */
function storage(values: Record<string, string> | "throws") {
  return {
    getItem(key: string) {
      if (values === "throws") throw new Error("storage is off");
      return Object.hasOwn(values, key) ? values[key] : null;
    },
    setItem() {
      throw new Error("the early script never writes");
    },
  };
}

/** Runs the script once, as a page's <head> would, and returns the root's attributes, the preloads and the API. */
function run(values: Record<string, string> | "throws" | "no-storage" | "getter-throws" = {}) {
  const win = new Window({ url: "https://manual.buildanagent.fyi/" });
  const document = win.document as unknown as Document;
  const context: Record<string, unknown> = { document };
  context.window = context;
  if (values === "getter-throws") {
    Object.defineProperty(context, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
  } else if (values !== "no-storage") {
    context.localStorage = storage(values);
  }
  runInContext(SOURCE, createContext(context));
  const root = document.documentElement;
  const preloads = [...document.head.querySelectorAll("link")].map((link) => ({
    rel: link.getAttribute("rel"),
    href: link.getAttribute("href"),
    as: link.getAttribute("as"),
    type: link.getAttribute("type"),
    crossorigin: link.getAttribute("crossorigin"),
  }));
  return {
    font: root.getAttribute("data-reading-font"),
    size: root.getAttribute("data-reading-size"),
    preloads,
    api: context.manualReadingSettings as Api,
    document,
  };
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("with nothing stored, the page keeps the default: no attribute, and Book's two upright files preloaded", () => {
  const page = run();
  assert.equal(page.font, null);
  assert.equal(page.size, null);
  assert.deepEqual(
    page.preloads.map((link) => link.href),
    ["/fonts/literata/literata-roman.woff2", "/fonts/instrument-serif/instrument-serif-regular.woff2"],
  );
  for (const link of page.preloads) {
    assert.deepEqual(
      { rel: link.rel, as: link.as, type: link.type, crossorigin: link.crossorigin },
      { rel: "preload", as: "font", type: "font/woff2", crossorigin: "anonymous" },
    );
  }
});

test("each stored pairing and size sets its attribute and preloads only that pairing's files", () => {
  for (const pairing of reading.pairings) {
    for (const size of reading.sizes) {
      const page = run({ "manual-reading-font": pairing.id, "manual-reading-size": String(size) });
      assert.equal(page.font, pairing.id === reading.default ? null : pairing.id, `${pairing.id} at ${size}`);
      assert.equal(page.size, size === reading.defaultSize ? null : String(size), `${pairing.id} at ${size}`);
      assert.deepEqual(
        page.preloads.map((link) => link.href),
        pairingPreloads(tokens, pairing),
        pairing.id,
      );
    }
  }
});

test("a stored value that is not exactly an allowed one is ignored", () => {
  for (const font of [
    "Sans",
    " sans",
    "sans ",
    "serif",
    "",
    "__proto__",
    "toString",
    "constructor",
    '"sans"',
    "null",
  ]) {
    const page = run({ "manual-reading-font": font, "manual-reading-size": "130" });
    assert.equal(page.font, null, JSON.stringify(font));
    assert.equal(page.size, "130", "a bad pairing leaves a good size alone");
  }
  for (const size of [
    "",
    "100.0",
    "115%",
    "1150",
    "015",
    "1e2",
    " 115",
    "115 ",
    "-90",
    "0",
    "120",
    "Infinity",
    "NaN",
  ]) {
    const page = run({ "manual-reading-font": "slab", "manual-reading-size": size });
    assert.equal(page.size, null, JSON.stringify(size));
    assert.equal(page.font, "slab", "a bad size leaves a good pairing alone");
  }
});

test("storage that is missing, whose getter throws or whose every read throws leaves the defaults", () => {
  for (const values of ["throws", "no-storage", "getter-throws"] as const) {
    const page = run(values);
    assert.equal(page.font, null, values);
    assert.equal(page.size, null, values);
    assert.equal(page.preloads.length, 2, values);
    assert.ok(page.api, `${values}: the API is still there for the settings panel`);
  }
});

test("the API reads and applies settings, and a default removes its attribute again", () => {
  const { api, document } = run({ "manual-reading-font": "readable", "manual-reading-size": "150" });
  const root = document.documentElement;
  assert.equal(root.getAttribute("data-reading-font"), "readable");
  assert.equal(api.FONT_KEY, "manual-reading-font");
  assert.equal(api.SIZE_KEY, "manual-reading-size");
  assert.deepEqual(plain(api.read(storage({ "manual-reading-font": "sans" }))), { font: "sans", size: 100 });
  assert.equal(api.readFont(undefined), "book");
  assert.equal(api.readSize(115), 100, "a stored value is a string; a number is not one");
  api.apply(root, { font: "book", size: 100 });
  assert.equal(root.hasAttribute("data-reading-font"), false);
  assert.equal(root.hasAttribute("data-reading-size"), false);
  api.apply(root, { font: "slab", size: 90 });
  assert.equal(root.getAttribute("data-reading-font"), "slab");
  assert.equal(root.getAttribute("data-reading-size"), "90");
  api.apply(root, { font: "nope", size: 101 });
  assert.equal(root.hasAttribute("data-reading-font"), false, "an unknown pairing falls back to the default");
  assert.equal(root.hasAttribute("data-reading-size"), false, "an unknown size falls back to the default");
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.PAIRINGS) && Object.isFrozen(api.SIZES));
});

test("the script's pairings, sizes and preloads are the ones book-tokens.json names", () => {
  const { api } = run();
  assert.equal(api.DEFAULT_FONT, reading.default);
  assert.equal(api.DEFAULT_SIZE, reading.defaultSize);
  assert.deepEqual(plain(api.SIZES), reading.sizes);
  assert.deepEqual(
    plain(api.PAIRINGS),
    Object.fromEntries(reading.pairings.map((pairing) => [pairing.id, pairingPreloads(tokens, pairing)])),
  );
});

test("the script never writes storage, touches the network or reads anything but its two keys", () => {
  assert.doesNotMatch(SOURCE, /setItem|removeItem|fetch\(|XMLHttpRequest|sendBeacon|import\(|\beval\(|innerHTML/);
  assert.doesNotMatch(SOURCE, /^\s*(export|import)\b/m, "a blocking classic script cannot be a module");
});

test("the layout loads the script blocking in <head>, before the stylesheet, with no static font preload", () => {
  const layout = readFileSync(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
  const tag = '<script is:inline src="/scripts/reading-settings.js"></script>';
  assert.ok(layout.includes(tag), "a classic script: no type, async or defer");
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  assert.ok(head.includes(tag), "it sits in <head>");
  assert.ok(head.indexOf(tag) < head.indexOf('<slot name="head" />'), "before any page's own head content");
  assert.ok(head.indexOf('src="/scripts/theme.js"') < head.indexOf(tag), "next to theme.js");
  assert.doesNotMatch(layout, /rel="preload"/, "the script preloads the chosen pairing, so the layout preloads none");
  for (const script of layout.match(/<script\b[^>]*>/g) ?? []) assert.match(script, /\ssrc="\/scripts\//, script);
});

// What reading.css may reference: a reading face's family only inside its @font-face rule and under the attribute of
// a pairing that uses it, so a page without that attribute never asks for the face's files.
test("the CSS names a pairing's families only under that pairing's attribute", () => {
  const styles = new URL("../src/styles/", import.meta.url);
  const sheets = readdirSync(styles).filter((name) => name.endsWith(".css"));
  const css = readFileSync(READING_CSS_URL, "utf8");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    body: match[2] ?? "",
  }));
  for (const [key, face] of Object.entries(reading.faces)) {
    const users = reading.pairings
      .filter((pairing) => pairing.display === key || pairing.body === key)
      .map((pairing) => `:root[data-reading-font="${pairing.id}"]`);
    assert.ok(users.length > 0, `${key} is used by a pairing`);
    for (const { selector, body } of blocks) {
      if (!body.includes(`"${face.cssFamily}"`)) continue;
      assert.ok(selector === "@font-face" || users.includes(selector), `${face.cssFamily} is named under ${selector}`);
    }
    for (const name of sheets.filter((sheet) => sheet !== "reading.css")) {
      const text = readFileSync(new URL(name, styles), "utf8");
      assert.doesNotMatch(text, new RegExp(`["']${face.cssFamily}["']`), `${name} names ${face.cssFamily}`);
    }
  }
  assert.doesNotMatch(css, /data-reading-font="book"/, "the default pairing needs no rule: it is tokens.css");
});

test("every pairing's faces are subsets fonts/sources.json lists, served with their OFL.txt", () => {
  const sources = JSON.parse(readFileSync(new URL("../fonts/sources.json", import.meta.url), "utf8")) as {
    families: { folder: string; fonts: { served: string }[]; licences: string[] }[];
  };
  const listed = new Set(
    sources.families.flatMap((family) => family.fonts.map((font) => `/fonts/${family.folder}/${font.served}`)),
  );
  const fonts = new URL("../public/fonts/", import.meta.url);
  for (const pairing of reading.pairings) {
    for (const face of [pairingFace(tokens, pairing.display), pairingFace(tokens, pairing.body)]) {
      for (const file of face.files) {
        assert.ok(listed.has(file.src), `${pairing.id}: fonts/sources.json lists ${file.src}`);
        assert.ok(existsSync(new URL(`.${file.src}`, new URL("../public/", import.meta.url))), file.src);
        const folder = file.src.split("/")[2];
        assert.ok(existsSync(new URL(`${folder}/OFL.txt`, fonts)), `${folder}/OFL.txt`);
      }
    }
  }
});
