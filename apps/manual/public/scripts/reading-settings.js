// The reader's typeface pairing and text size. The page loads this file as a blocking script in <head>, before the
// stylesheet, so a stored choice is on <html> before the first paint and the page never shows one pairing or size and
// then another: data-reading-font names the pairing and data-reading-size the size step, and src/styles/reading.css
// reads both. It also preloads the chosen pairing's upright files, so only that pairing's fonts are requested.
//
// The choice lives in this browser's localStorage under two keys. Every read sits in try/catch, the whole start-up does
// too, and every value is checked against the lists below, so blocked storage, a damaged value or a browser that lacks
// a feature leaves the default: Book at 100%, with no attribute. Without JavaScript the page shows the default and preloads nothing; the stylesheet still loads Book's
// fonts.
//
// The file is served as-is from public/, not bundled, so it stays a same-origin script that the content security policy
// allows by path. A blocking script cannot be a module, so it cannot export: it puts its functions on
// window.manualReadingSettings, which it sets before it reads anything, for the settings panel to share, and the tests run it in a sandbox to read them. The
// lists below are checked against docs/design/book-tokens.json by test/reading-settings.test.ts.
(() => {
  /** The localStorage key that holds the pairing's id. */
  const FONT_KEY = "manual-reading-font";
  /** The localStorage key that holds the text size, in percent. */
  const SIZE_KEY = "manual-reading-size";
  const DEFAULT_FONT = "book";
  const DEFAULT_SIZE = 100;
  /** Each pairing's id and the upright files its text starts with: the body face, then the headings' face. */
  const PAIRINGS = Object.freeze({
    book: Object.freeze([
      "/fonts/literata/literata-roman.woff2",
      "/fonts/instrument-serif/instrument-serif-regular.woff2",
    ]),
    readable: Object.freeze([
      "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-regular.woff2",
      "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-bold.woff2",
    ]),
    sans: Object.freeze(["/fonts/inter/inter-roman.woff2", "/fonts/space-grotesk/space-grotesk-roman.woff2"]),
    slab: Object.freeze(["/fonts/bitter/bitter-roman.woff2"]),
  });
  /** The pairings' ids; Object.keys and includes work in every browser, where Object.hasOwn needs Safari 15.4. */
  const FONT_IDS = Object.keys(PAIRINGS);
  /** The text-size steps, in percent of the browser's default font size. */
  const SIZES = Object.freeze([90, 100, 115, 130, 150]);

  /** The pairing a stored value names, or the default for anything that is not one of the pairings' ids. */
  const readFont = (raw) => (typeof raw === "string" && FONT_IDS.includes(raw) ? raw : DEFAULT_FONT);

  /** The size step a stored value names, or the default for anything that is not exactly one of the steps. */
  const readSize = (raw) => {
    const index = typeof raw === "string" ? SIZES.findIndex((size) => String(size) === raw) : -1;
    return index === -1 ? DEFAULT_SIZE : SIZES[index];
  };

  const get = (storage, key) => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  /** Reads both settings from a storage; a storage that is missing or throws gives the defaults. */
  const read = (storage) => ({ font: readFont(get(storage, FONT_KEY)), size: readSize(get(storage, SIZE_KEY)) });

  /**
   * Puts the settings on the root element as data-reading-font and data-reading-size. The default pairing and the
   * default size remove their attribute, so a default always reads as no attribute and the page is exactly as it was
   * before the reader chose.
   */
  const apply = (root, settings) => {
    const font = readFont(settings.font);
    const size = readSize(String(settings.size));
    if (font === DEFAULT_FONT) root.removeAttribute("data-reading-font");
    else root.setAttribute("data-reading-font", font);
    if (size === DEFAULT_SIZE) root.removeAttribute("data-reading-size");
    else root.setAttribute("data-reading-size", String(size));
  };

  /** Adds a preload link to `head` for each upright file the pairing's text starts with. */
  const preload = (doc, font) => {
    for (const href of PAIRINGS[readFont(font)]) {
      const link = doc.createElement("link");
      link.rel = "preload";
      link.href = href;
      link.as = "font";
      link.type = "font/woff2";
      link.crossOrigin = "anonymous";
      doc.head.append(link);
    }
  };

  // The API goes up first, so a failure below never leaves the settings panel without it.
  window.manualReadingSettings = Object.freeze({
    FONT_KEY,
    SIZE_KEY,
    DEFAULT_FONT,
    DEFAULT_SIZE,
    PAIRINGS,
    SIZES,
    readFont,
    readSize,
    read,
    apply,
  });

  try {
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      // Storage can be off; the page then shows the defaults.
    }
    const settings = read(storage);
    apply(document.documentElement, settings);
    preload(document, settings.font);
  } catch {
    // A browser that lacks something this file uses leaves the page at its defaults rather than stopping the script.
  }
})();
