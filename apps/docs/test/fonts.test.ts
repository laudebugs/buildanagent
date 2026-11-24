import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readTokens } from "@buildanagent/manual/design/tokens";
import { test } from "vitest";
import { PLEX_MIN_AGE_DAYS } from "../scripts/plex-release.js";
import {
  BOOK_FONTS_URL,
  bookFontFilesForDocs,
  copyFonts,
  DOCS_FONTS_URL,
  DOCS_TOKENS_CSS_URL,
  docsFontFolders,
  docsTokens,
  fontFiles,
  fontFolders,
  PLEX_FALLBACK_FAMILY,
  PLEX_FALLBACKS,
  PLEX_FONTS_URL,
  preloadedFonts,
  readPlexPin,
  weightIncludes,
} from "../src/design/theme.js";

// The docs serve two folders copied from the book and one of their own, IBM Plex Sans, which the pin file records.
const plexFiles = fontFiles(PLEX_FONTS_URL).map((file) => `ibm-plex-sans/${file}`);
const docsFiles = fontFiles(DOCS_FONTS_URL).filter((file) => !file.startsWith("ibm-plex-sans/"));
const sha256 = (url: URL): string => createHash("sha256").update(readFileSync(url)).digest("hex");

test("the docs serve exactly the book's display and code files, with their licences, and their own Plex files", () => {
  assert.deepEqual(docsFontFolders(), ["instrument-serif", "manual-code"]);
  assert.ok(docsFiles.some((file) => file.endsWith("/OFL.txt")));
  assert.ok(docsFiles.includes("manual-code/TRADEMARKS.md"));
  assert.deepEqual(
    docsFiles,
    bookFontFilesForDocs(),
    "public/fonts/ differs from the book's: run pnpm --filter @buildanagent/docs tokens",
  );
});

test("every docs font file is byte-identical to the book's", () => {
  for (const file of docsFiles) {
    assert.ok(
      readFileSync(new URL(file, DOCS_FONTS_URL)).equals(readFileSync(new URL(file, BOOK_FONTS_URL))),
      `public/fonts/${file} differs from the book's: run pnpm --filter @buildanagent/docs tokens`,
    );
  }
});

test("the Plex files are the ones the pin records, byte for byte, with IBM's licence beside them", () => {
  const pin = readPlexPin();
  assert.equal(pin.license, "OFL-1.1");
  assert.match(pin.copyright, /Reserved Font Name "Plex"/);
  assert.deepEqual(
    plexFiles,
    [
      ...pin.files.map((file) => `ibm-plex-sans/${file.name}`),
      `ibm-plex-sans/${pin.licenseFile.name}`,
      "ibm-plex-sans/SOURCE.md",
    ].sort(),
    "public/fonts/ibm-plex-sans/ holds a file the pin lacks, or lacks one it has",
  );
  for (const file of pin.files) {
    const url = new URL(file.name, PLEX_FONTS_URL);
    assert.equal(
      sha256(url),
      file.sha256,
      `${file.name} differs from the pin: run pnpm --filter @buildanagent/docs fonts:plex`,
    );
    assert.equal(readFileSync(url).length, file.bytes, `${file.name} has another size than the pin records`);
  }
  assert.equal(sha256(new URL(pin.licenseFile.name, PLEX_FONTS_URL)), pin.licenseFile.sha256);
  const note = readFileSync(new URL("SOURCE.md", PLEX_FONTS_URL), "utf8");
  for (const hash of [...pin.files.map((file) => file.sha256), pin.licenseFile.sha256]) {
    assert.ok(note.includes(hash), `SOURCE.md lacks ${hash}`);
  }
  assert.ok(note.includes(`${pin.package}\` ${pin.version}`), "SOURCE.md names another version than the pin");
  assert.ok(note.includes(pin.published) && note.includes(pin.gitHead));
});

// Offline, the test can only compare the dates the pin records: fonts:plex checks the publish date against the
// registry, and refuses a release under a week old, when it writes them.
test("the pinned release was at least a week old when it was pinned, and the faces are the three the docs use", () => {
  const pin = readPlexPin();
  assert.match(pin.version, /^\d+\.\d+\.\d+$/);
  assert.match(pin.published, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(pin.pinned, /^\d{4}-\d{2}-\d{2}$/);
  const days = (Date.parse(pin.pinned) - Date.parse(pin.published)) / (24 * 60 * 60 * 1000);
  assert.ok(days >= PLEX_MIN_AGE_DAYS, `${pin.version} was ${days} days old when it was pinned`);
  assert.ok(Date.parse(pin.pinned) <= Date.now(), "the pin's date is in the future");
  assert.match(pin.integrity, /^sha512-/);
  assert.deepEqual(
    pin.files.map((file) => `${file.style} ${file.weight}`),
    ["normal 400", "italic 400", "normal 600"],
  );
  assert.ok(pin.files.every((file) => file.name.endsWith("-Latin1.woff2")));
});

test("every file the docs tokens name is served from the docs' public folder", () => {
  const tokens = docsTokens();
  const served = [...docsFiles, ...plexFiles];
  for (const font of [tokens.font.display, tokens.font.body, tokens.font.code]) {
    for (const file of font.files) assert.ok(served.includes(file.src.replace(/^\/fonts\//, "")), file.src);
  }
});

test("the head preloads the Plex regular and Instrument Serif romans, and nothing else", () => {
  const head = readFileSync(new URL("../src/components/Head.astro", import.meta.url), "utf8");
  const preloaded = [...head.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin/g)];
  assert.deepEqual(
    preloaded.map((match) => match[1]),
    preloadedFonts(),
  );
  assert.deepEqual(preloadedFonts(), [
    "/fonts/ibm-plex-sans/IBMPlexSans-Regular-Latin1.woff2",
    "/fonts/instrument-serif/instrument-serif-regular.woff2",
  ]);
  const config = readFileSync(new URL("../astro.config.mjs", import.meta.url), "utf8");
  assert.match(config, /Head: "\.\/src\/components\/Head\.astro"/);
});

test("the body font is IBM Plex Sans, the display font is Instrument Serif and no Inter or Literata is left", () => {
  const tokens = docsTokens();
  assert.equal(tokens.font.body.cssFamily, "IBM Plex Sans");
  assert.equal(tokens.font.display.cssFamily, "Instrument Serif");
  assert.equal(tokens.font.code.cssFamily, "Manual Code");
  const css = readFileSync(DOCS_TOKENS_CSS_URL, "utf8");
  assert.match(
    css,
    /--font-body: "IBM Plex Sans", "IBM Plex Sans Fallback", system-ui, -apple-system, "Segoe UI", sans-serif;/,
  );
  assert.match(css, /--font-display: "Instrument Serif", /);
  assert.doesNotMatch(css, /Literata|Inter\b/i);
  const head = readFileSync(new URL("../src/components/Head.astro", import.meta.url), "utf8");
  assert.doesNotMatch(head, /literata|inter\//i);
  for (const folder of ["inter", "literata"]) {
    assert.ok(
      ![...docsFiles, ...plexFiles].some((file) => file.startsWith(`${folder}/`)),
      `${folder} is still in public/fonts/`,
    );
  }
});

test("every Plex face is declared with its weight, style and unicode range, and the stand-in faces keep the line box", () => {
  const css = readFileSync(DOCS_TOKENS_CSS_URL, "utf8");
  const pin = readPlexPin();
  for (const file of pin.files) {
    const rule = new RegExp(
      `@font-face \\{\\n {2}font-family: "IBM Plex Sans";\\n {2}src: url\\("/fonts/ibm-plex-sans/${file.name}"\\) format\\("woff2"\\);\\n {2}font-style: ${file.style};\\n {2}font-weight: ${file.weight};\\n {2}font-display: swap;\\n {2}unicode-range:\\n {4}${pin.unicodeRange.replace(/[+]/g, "\\+")};`,
    );
    assert.match(css, rule, file.name);
  }
  // Plex's hhea ascent and descent are 1.025 and 0.275 em and its line gap is 0, so each stand-in sets them divided by
  // its size adjustment, and the line box matches Plex's.
  assert.equal(css.match(new RegExp(`font-family: "${PLEX_FALLBACK_FAMILY}";`, "g"))?.length, PLEX_FALLBACKS.length);
  for (const face of PLEX_FALLBACKS) {
    const ascent = Number(((102.5 * 100) / face.sizeAdjust).toFixed(1));
    const descent = Number(((27.5 * 100) / face.sizeAdjust).toFixed(1));
    assert.ok(
      css.includes(
        `size-adjust: ${face.sizeAdjust}%;\n  ascent-override: ${ascent}%;\n  descent-override: ${descent}%;\n  line-gap-override: 0%;`,
      ),
    );
  }
});

test("the tokens script removes stray files beside the book's folders, keeps the Plex folder and makes a missing one", () => {
  const root = mkdtempSync(join(tmpdir(), "docs-fonts-"));
  try {
    const target = pathToFileURL(join(root, "fonts/"));
    assert.deepEqual(fontFolders(target), []);
    copyFonts(target);
    assert.deepEqual(fontFolders(target), docsFontFolders());
    mkdirSync(join(root, "fonts", "ibm-plex-sans"));
    writeFileSync(join(root, "fonts", "ibm-plex-sans", "kept.woff2"), "");
    mkdirSync(join(root, "fonts", "inter"));
    writeFileSync(join(root, "fonts", "stray.woff2"), "");
    copyFonts(target);
    assert.deepEqual(readdirSync(join(root, "fonts")).sort(), [...docsFontFolders(), "ibm-plex-sans"].sort());
    assert.ok(existsSync(join(root, "fonts", "ibm-plex-sans", "kept.woff2")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a variable font whose weight range covers 400 is preloaded as the regular face", () => {
  assert.ok(weightIncludes("400", 400));
  assert.ok(weightIncludes("300 700", 400));
  assert.ok(!weightIncludes("600", 400));
  assert.ok(!weightIncludes("500 900", 400));
  const tokens = readTokens();
  const display = {
    ...tokens.font.display,
    files: [{ src: "/fonts/instrument-serif/variable.woff2", style: "normal" as const, weight: "300 700" }],
  };
  const preloaded = preloadedFonts({ ...tokens, font: { ...tokens.font, display } });
  assert.equal(preloaded[1], "/fonts/instrument-serif/variable.woff2");
});
