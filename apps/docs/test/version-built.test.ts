import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { mainDocsLink } from "../src/chrome.js";
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
    const src = /\bsrc="([^"]+)"/.exec(match[1] ?? "")?.[1];
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

test("every page links 'Docs for main' to the next. host, from the footer", () => {
  for (const { path, html } of pages()) {
    // Astro adds a scoping class to the anchor, so the match allows other attributes after the address.
    const link = new RegExp(`<a href="${mainDocsLink.href}"[^>]*>${mainDocsLink.label}</a>`);
    assert.match(html, link, `${path}: no ${mainDocsLink.label} link`);
  }
  assert.equal(new URL(mainDocsLink.href).hostname, "next.docs.buildanagent.fyi");
});
