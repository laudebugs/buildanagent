import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { fluidSize, fontUrl, readTokens, TOKENS_CSS_URL, tokenProblems, tokensCss } from "../src/design/tokens.js";

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
