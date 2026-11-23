import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  fluidSize,
  fontUrl,
  pairingFace,
  pairingPreloads,
  READING_CSS_URL,
  readingCss,
  readingProblems,
  readTokens,
  TOKENS_CSS_URL,
  tokenProblems,
  tokensCss,
} from "../src/design/tokens.js";

test("the committed tokens.css is what the generator writes from book-tokens.json", () => {
  assert.equal(
    readFileSync(TOKENS_CSS_URL, "utf8"),
    tokensCss(readTokens()),
    "src/styles/tokens.css is stale: change docs/design/book-tokens.json, then run pnpm --filter @buildanagent/manual tokens",
  );
});

test("every page and panel token in book-tokens.json has a light and a dark value", () => {
  assert.deepEqual(tokenProblems(readTokens()), []);
});

test("a page token without a dark value stops the generator", () => {
  const tokens = readTokens();
  const { link: _, ...dark } = tokens.color.dark.values;
  const broken = { ...tokens, color: { ...tokens.color, dark: { ...tokens.color.dark, values: dark } } };
  assert.deepEqual(tokenProblems(broken), ["light.link has no dark value"]);
  assert.throws(() => tokensCss(broken), /light\.link has no dark value/);
});

test("a panel token without a dark value stops the generator", () => {
  const tokens = readTokens();
  const { border: _, ...panel } = tokens.color.panelDark.values;
  const broken = { ...tokens, color: { ...tokens.color, panelDark: { ...tokens.color.panelDark, values: panel } } };
  assert.deepEqual(tokenProblems(broken), ["panelLight.border has no panelDark value"]);
});

test("a size scales from its phone value at 360 px to its desktop value at 1280 px", () => {
  const viewport = { phone: 360, desktop: 1280 };
  assert.equal(fluidSize({ phone: 44, desktop: 80 }, viewport), "clamp(2.75rem, 1.8696rem + 3.913vw, 5rem)");
  assert.equal(fluidSize({ phone: 12, desktop: 12 }, viewport), "0.75rem");
});

test("another site's tokens file takes its own header and font folder and keeps every other line", () => {
  const tokens = readTokens();
  const book = tokensCss(tokens);
  const other = tokensCss(tokens, {
    header: ["Written by another site.", "Run its own command."],
    fontBase: "/assets/f/",
  });
  assert.ok(other.startsWith("/* Written by another site.\n   Run its own command. */\n"));
  assert.match(other, /src: url\("\/assets\/f\/literata\/literata-roman\.woff2"\)/);
  assert.doesNotMatch(other, /url\("\/fonts\//);
  const body = (css: string): string => css.slice(css.indexOf("*/")).replace(/url\("[^"]*"\)/g, "url()");
  assert.equal(body(other), body(book));
});

test("a font folder must end in a slash, and a font file must sit under /fonts/", () => {
  assert.equal(fontUrl("/fonts/a/b.woff2", "/x/"), "/x/a/b.woff2");
  assert.throws(() => fontUrl("/fonts/a/b.woff2", "/x"), /does not end in \//);
  assert.throws(() => fontUrl("/elsewhere/b.woff2"), /is not under \/fonts\//);
  assert.throws(() => tokensCss(readTokens(), { header: ["a */ b"] }), /cannot contain \*\//);
});

test("the committed reading.css is what the generator writes from book-tokens.json", () => {
  assert.equal(
    readFileSync(READING_CSS_URL, "utf8"),
    readingCss(readTokens()),
    "src/styles/reading.css is stale: change docs/design/book-tokens.json, then run pnpm --filter @buildanagent/manual tokens",
  );
});

test("the reading block has four pairings, Book first and the default, and the five text sizes", () => {
  const { reading } = readTokens().font;
  assert.deepEqual(readingProblems(readTokens()), []);
  assert.deepEqual(
    reading.pairings.map((pairing) => [pairing.id, pairing.label, pairing.displayWeight]),
    [
      ["book", "Book", 400],
      ["readable", "Readable", 700],
      ["sans", "Sans", 600],
      ["slab", "Slab", 700],
    ],
  );
  assert.equal(reading.default, "book");
  assert.deepEqual(reading.sizes, [90, 100, 115, 130, 150]);
  assert.equal(reading.defaultSize, 100);
});

test("a pairing that names a missing face, or a default that is no pairing or step, stops the generator", () => {
  const tokens = readTokens();
  const broken = {
    ...tokens,
    font: {
      ...tokens.font,
      reading: {
        ...tokens.font.reading,
        default: "plain",
        defaultSize: 120,
        pairings: [...tokens.font.reading.pairings, { ...tokens.font.reading.pairings[1], id: "Odd", body: "comic" }],
      },
    },
  } as typeof tokens;
  assert.deepEqual(readingProblems(broken), [
    "the default pairing plain is not a pairing",
    "pairing id Odd is not lower-case letters",
    "pairing Odd names the face comic, which font.reading.faces lacks",
    "the default size 120 is no step",
  ]);
  assert.throws(() => readingCss(broken), /cannot generate reading\.css/);
});

test("a face or pairing name that only Object.prototype has is a missing face", () => {
  const tokens = readTokens();
  for (const name of ["constructor", "toString", "__proto__"]) {
    assert.throws(() => pairingFace(tokens, name), /book-tokens\.json lacks/);
    const broken = {
      ...tokens,
      font: {
        ...tokens.font,
        reading: {
          ...tokens.font.reading,
          pairings: [...tokens.font.reading.pairings, { ...tokens.font.reading.pairings[1], id: "odd", body: name }],
        },
      },
    } as typeof tokens;
    assert.deepEqual(readingProblems(broken), [`pairing odd names the face ${name}, which font.reading.faces lacks`]);
  }
});

test("the default pairing must use the book's own faces, because readingCss writes no family rule for it", () => {
  const tokens = readTokens();
  const withDefault = (change: Record<string, string>) =>
    ({
      ...tokens,
      font: {
        ...tokens.font,
        reading: {
          ...tokens.font.reading,
          pairings: tokens.font.reading.pairings.map((pairing) =>
            pairing.id === tokens.font.reading.default ? { ...pairing, ...change } : pairing,
          ),
        },
      },
    }) as typeof tokens;
  assert.deepEqual(readingProblems(withDefault({ body: "atkinsonHyperlegible" })), [
    "the default pairing book must use the book's own display and body faces",
  ]);
  assert.deepEqual(readingProblems(withDefault({ display: "atkinsonHyperlegible" })), [
    "the default pairing book must use the book's own display and body faces",
  ]);
  assert.throws(() => readingCss(withDefault({ body: "atkinsonHyperlegible" })), /cannot generate reading\.css/);
});

test("a size step sets the root font size and the scale the header divides by; the default sets neither", () => {
  const css = readingCss(readTokens());
  assert.match(css, /:root \{\n {2}--weight-display: 400;\n {2}--reading-scale: 1;\n\}/);
  assert.match(css, /:root\[data-reading-size="150"\] \{\n {2}--reading-scale: 1\.5;\n {2}font-size: 150%;\n\}/);
  assert.match(css, /:root\[data-reading-size="90"\] \{\n {2}--reading-scale: 0\.9;\n {2}font-size: 90%;\n\}/);
  assert.doesNotMatch(css, /data-reading-size="100"/);
});

test("a pairing preloads its body's upright file and the display file that covers its heading weight", () => {
  const tokens = readTokens();
  const preloads = Object.fromEntries(
    tokens.font.reading.pairings.map((pairing) => [pairing.id, pairingPreloads(tokens, pairing)]),
  );
  assert.deepEqual(preloads, {
    book: ["/fonts/literata/literata-roman.woff2", "/fonts/instrument-serif/instrument-serif-regular.woff2"],
    readable: [
      "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-regular.woff2",
      "/fonts/atkinson-hyperlegible/atkinson-hyperlegible-bold.woff2",
    ],
    sans: ["/fonts/inter/inter-roman.woff2", "/fonts/space-grotesk/space-grotesk-roman.woff2"],
    slab: ["/fonts/bitter/bitter-roman.woff2"],
  });
});
