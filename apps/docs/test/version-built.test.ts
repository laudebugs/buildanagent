import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { mainDocsLinkFor } from "../src/chrome.js";
import { STARLIGHT_PAIRS } from "../src/design/pairs.js";
import { STABLE_DOCS_URL } from "../src/version/banner.js";
import { SDK_VERSION } from "../src/version/version.js";
import { builtSite } from "./built.js";

// What the built pages carry for versioning: the SDK's version in the header, the hidden banner, the one static script
// that reveals it and the "Docs for main" link. test/banner.test.ts tests the decision itself.
const pages = (): { path: string; html: string }[] =>
  readdirSync(builtSite(), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".html"))
    .map((path) => ({ path, html: readFileSync(join(builtSite(), path), "utf8") }));

/** The text of every script on the page that mentions the banner, inline or from a file the page loads. */
function bannerScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = /(?:^|\s)src="([^"]+)"/.exec(match[1] ?? "")?.[1];
    const text = src === undefined ? (match[2] ?? "") : readFileSync(join(builtSite(), src), "utf8");
    if (text.includes("data-unreleased-banner")) scripts.push(text);
  }
  return scripts;
}

test("every page shows the SDK's version in the header, with a label a screen reader reads as 'Version <number>'", () => {
  assert.match(SDK_VERSION, /^\d+\.\d+\.\d+/);
  for (const { path, html } of pages()) {
    assert.ok(/<span class="version[ "]/.test(html), `${path}: no version tag`);
    const tag = /<span class="version[ "][^>]*>(.*?)<\/span>(?=<\/div>)/s.exec(html)?.[1] ?? "";
    assert.equal(tag.replace(/<[^>]*>/g, ""), `Version ${SDK_VERSION}`, `${path}: version text`);
    const link = /<a [^>]*class="site-title[^"]*"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";
    assert.ok(link !== "" && !link.includes(SDK_VERSION), `${path}: the version stays outside the home link`);
  }
});

test("every page has the banner, hidden in the HTML itself, with its note role and its link to the stable docs", () => {
  for (const { path, html } of pages()) {
    const banner = /<div[^>]*data-unreleased-banner[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0];
    assert.ok(banner, `${path}: no banner element`);
    const open = /^<div[^>]*>/.exec(banner)?.[0] ?? "";
    assert.match(open, /\bhidden\b/, `${path}: the banner must be hidden until the script runs`);
    assert.match(open, /role="note"/);
    assert.match(open, /aria-label="Unreleased docs"/);
    assert.match(banner, /Unreleased docs for main/);
    assert.ok(banner.includes(`href="${STABLE_DOCS_URL}"`), `${path}: no link to the stable docs`);
  }
});

test("one static script reveals the banner: identical text on every page, with no value from the build in it", () => {
  const all = pages();
  const texts = new Set<string>();
  for (const { path, html } of all) {
    const scripts = bannerScripts(html);
    assert.equal(scripts.length, 1, `${path}: expected one banner script, found ${scripts.length}`);
    texts.add(scripts[0] as string);
  }
  assert.equal(texts.size, 1, "the banner script's text differs between pages, so a CSP could not hash it once");
  const [script] = [...texts] as [string];
  assert.ok(script.includes("next."), "the script holds the hostname rule");
  assert.ok(script.includes("location.hostname"), "the script reads the page's host");
  assert.ok(!script.includes(SDK_VERSION), "the script must not carry the version");
  assert.ok(!/\/(?:start|concepts|guides|testing|reference)\//.test(script), "the script must not carry a page path");
  assert.ok(!script.includes("docs.buildanagent.fyi"), "the script must not hard-code the production host");
});

test("no page adds a robots meta tag, which would also reach the production host", () => {
  for (const { path, html } of pages()) {
    assert.doesNotMatch(html, /<meta[^>]*name="robots"/i, `${path}: noindex belongs in the _headers file`);
  }
});

// Escapes a string for use inside a regular expression.
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the footer links 'Docs for main' on every page exactly when the SDK is stable, and on no page before", () => {
  const link = mainDocsLinkFor(SDK_VERSION);
  for (const { path, html } of pages()) {
    // Our paragraphs follow Starlight's footer element, not sit inside it. Astro adds a scoping class to each element.
    const footerEnd = html.lastIndexOf("</footer>");
    assert.ok(footerEnd !== -1, `${path}: no footer`);
    const region = html.slice(footerEnd);
    assert.ok(
      region.includes('class="license'),
      `${path}: the licence line follows the footer, so this finds the region`,
    );
    const paragraph = /<p class="main-docs[^"]*"[^>]*>[\s\S]*?<\/p>/.exec(region)?.[0];
    if (link === undefined) {
      assert.equal(paragraph, undefined, `${path}: the SDK is not stable, so next.docs has no deploy to link to`);
      assert.ok(!region.includes("next.docs.buildanagent.fyi"), `${path}: nothing in the footer names the unused host`);
    } else {
      const anchor = new RegExp(`<a href="${escapeRegExp(link.href)}"[^>]*>${escapeRegExp(link.label)}</a>`);
      assert.match(paragraph ?? "", anchor, `${path}: no ${link.label} link in the footer`);
    }
  }
});

/** Every rule in the built CSS whose selector names `.unreleased-banner`: its selector and its declarations. */
function bannerRules(): { selector: string; body: string }[] {
  const css = readdirSync(builtSite(), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".css"))
    .map((path) => readFileSync(join(builtSite(), path), "utf8"))
    .join("\n");
  return [...css.matchAll(/([^{}]*\.unreleased-banner[^{}]*)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
}

test("the built CSS styles the banner itself: Starlight's own rules are scoped to its component and miss our element", () => {
  const rules = bannerRules();
  const own = rules.find(
    ({ selector }) =>
      !selector.includes("[hidden]") && /\.unreleased-banner(?:\[[^\]]*\]|:where\([^)]*\))*$/.test(selector),
  );
  assert.ok(own, "no built rule styles .unreleased-banner itself");
  assert.match(own.body, /background-color:var\(--sl-color-bg-accent\)/);
  assert.match(own.body, /(?:^|;)color:var\(--sl-color-text-invert\)/);
  assert.match(own.body, /padding:var\(--sl-nav-pad-y\) var\(--sl-nav-pad-x\)/);
  const link = rules.find(({ selector }) => /\.unreleased-banner\S* a(?::where\([^)]*\))*$/.test(selector));
  assert.match(
    link?.body ?? "",
    /(?:^|;)color:var\(--sl-color-text-invert\)/,
    "the link takes the banner's text colour",
  );
  const focus = rules.find(({ selector }) => selector.includes(":focus-visible"));
  assert.match(
    focus?.body ?? "",
    /outline:2px solid var\(--sl-color-text-invert\)/,
    "the focus ring is visible on the fill",
  );
});

test("the banner's colours are the measured pair: the text token is the page background and the fill is the accent", () => {
  const mapping = readFileSync(new URL("../src/styles/starlight.css", import.meta.url), "utf8");
  assert.match(mapping, /--sl-color-text-invert:\s*var\(--color-background\)/);
  assert.match(mapping, /--sl-color-bg-accent:\s*var\(--color-accent\)/);
  const pair = STARLIGHT_PAIRS.find((entry) => entry.role === "a banner on the accent");
  assert.deepEqual([pair?.color, pair?.on, pair?.kind], ["page.background", "page.accent", "text"]);
  const ring = STARLIGHT_PAIRS.find((entry) => entry.role === "the focus ring on a banner");
  assert.deepEqual([ring?.color, ring?.on, ring?.kind], ["page.background", "page.accent", "nonText"]);
});
