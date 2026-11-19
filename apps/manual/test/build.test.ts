import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, test } from "vitest";

// Builds the site into a temporary folder once, then checks the pages the build writes: the gallery renders every
// component in both themes with its script-only controls hidden, and no page loads anything from another origin.
const app = fileURLToPath(new URL("..", import.meta.url));
let out = "";

function nearestBin(name: string): string {
  for (let dir = app; dir !== dirname(dir); dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
  }
  throw new Error(`no node_modules/.bin/${name} above ${app}`);
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "manual-build-"));
  const home = mkdtempSync(join(tmpdir(), "manual-home-"));
  // An allowlisted environment, never ...process.env (AGENTS.md), with Astro's telemetry off so the build stays offline.
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  await promisify(execFile)(nearestBin("astro"), ["build", "--outDir", out], { cwd: app, env });
  rmSync(home, { recursive: true, force: true });
}, 180_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

function files(extension: string): string[] {
  return readdirSync(out, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(extension));
}

function gallery(): string {
  return readFileSync(join(out, "gallery", "index.html"), "utf8");
}

const COMPONENTS = [
  "chapter-head",
  "figure",
  "stepper",
  "listing",
  "annotation-marker",
  "annotations",
  "tabs",
  "tabs__panel",
  "replay",
  "sidenote",
  "glossary-card",
  "glossary-term",
  "citation",
  "search-box",
  "contents",
  "sidebar",
  "prev-next",
  "theme-toggle",
];

test("the gallery renders every component once in the light theme and once in the dark", () => {
  const html = gallery();
  assert.match(html, /<section class="gallery__theme layout" data-theme="light"/);
  assert.match(html, /<section class="gallery__theme layout" data-theme="dark"/);
  const [light = "", dark = ""] = html.split('data-theme="dark"');
  for (const name of COMPONENTS) {
    const pattern = new RegExp(`class="([^"]* )?${name}( [^"]*)?"`);
    assert.match(light, pattern, `the light half renders .${name}`);
    assert.match(dark, pattern, `the dark half renders .${name}`);
  }
});

test("the gallery stays out of the search index and out of search engines", () => {
  const html = gallery();
  assert.doesNotMatch(html, /data-pagefind-body/);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test("without JavaScript the gallery shows no dead controls and every step and event", () => {
  const html = gallery();
  for (const tag of html.match(/<[a-z]+[^>]*data-(step-controls|theme-toggle)[^>]*>/g) ?? []) {
    assert.match(tag, /\shidden(\s|>|=)/, `${tag} renders hidden until its script runs`);
  }
  assert.equal((html.match(/class="stepper__step"/g) ?? []).length, 6);
  assert.equal((html.match(/class="replay__event"/g) ?? []).length, 10);
  for (const pre of html.match(/<pre class="listing__code"[^>]*>/g) ?? []) {
    assert.match(pre, /tabindex="0"/, "a listing that scrolls can be scrolled from the keyboard");
  }
});

test("every id on the gallery page is unique", () => {
  const ids = [...gallery().matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(repeated, []);
});

function pages(): { path: string; html: string }[] {
  return files(".html").map((path) => ({ path, html: readFileSync(join(out, path), "utf8") }));
}

test("no page loads a font, script, stylesheet or image from another origin", () => {
  for (const { path, html } of pages()) {
    for (const tag of html.match(/<(link|script|img|source|iframe|video|audio)\b[^>]*>/g) ?? []) {
      assert.doesNotMatch(tag, /\s(src|href|srcset)="(https?:)?\/\//, `${path}: ${tag}`);
    }
  }
});

test("no built stylesheet imports or points at another origin", () => {
  for (const path of files(".css")) {
    assert.doesNotMatch(readFileSync(join(out, path), "utf8"), /@import|url\(\s*["']?(https?:)?\/\//, path);
  }
});

// Inline styles and scripts would need hashes or 'unsafe-inline' in the content security policy.
test("no page inlines a stylesheet", () => {
  for (const { path, html } of pages()) assert.doesNotMatch(html, /<style/, path);
});

test("no page inlines a script", () => {
  for (const { path, html } of pages()) assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, path);
});

test("no page links to a site page that does not exist", () => {
  const built = new Set(files(".html").map((path) => `/${path.replace(/index\.html$/, "")}`));
  for (const { path, html } of pages()) {
    for (const [, href = ""] of html.matchAll(/<a\b[^>]*\shref="(\/[^"#?]*)/g)) {
      if (href.startsWith("/fonts/") || href.startsWith("/pagefind/")) continue;
      // The gallery's citation and glossary samples link to the source register and the glossary, the pages the
      // content model adds; every other page must link only to pages the build writes.
      if (path === "gallery/index.html" && (href === "/sources/" || href === "/glossary/")) continue;
      assert.ok(built.has(href), `${path} links to ${href}, which the build does not write`);
    }
  }
});

test("the chapter page and each gallery theme are layout containers, so the columns follow their width", () => {
  assert.match(readFileSync(join(out, "welcome", "index.html"), "utf8"), /class="page layout"/);
  assert.equal((gallery().match(/class="gallery__theme layout"/g) ?? []).length, 2);
});

test("the built stylesheet carries the generated tokens and the self-hosted font faces", () => {
  const css = files(".css")
    .map((path) => readFileSync(join(out, path), "utf8"))
    .join("\n");
  assert.match(css, /--panel-background:\s*#f3eadb/);
  assert.match(css, /--panel-background:\s*#17110d/);
  for (const family of ["Instrument Serif", "Literata", "Manual Code"]) {
    assert.match(css, new RegExp(`font-family:\\s*"?${family}"?`), `the CSS declares ${family}`);
  }
});
