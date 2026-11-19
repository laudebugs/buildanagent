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
// The book has no chapter yet, so the build reads one fixture chapter, written as Chapter 1, through BOOK_FIXTURE_DIR.
const app = fileURLToPath(new URL("..", import.meta.url));
const fixtureBook = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
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
    BOOK_FIXTURE_DIR: fixtureBook,
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

function chapter(): string {
  return readFileSync(join(out, "call-workflow-loop", "index.html"), "utf8");
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
      assert.ok(built.has(href), `${path} links to ${href}, which the build does not write`);
    }
  }
});

test("the chapter page and each gallery theme are layout containers, so the columns follow their width", () => {
  assert.match(chapter(), /class="page layout"/);
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

test("a chapter page shows its number from the outline and its numbered source list", () => {
  const html = chapter();
  assert.match(html, /<p class="chapter-head__label label">Chapter 1<\/p>/);
  assert.match(
    html,
    /<span class="number figure__number label">Figure 1\.1<\/span> A call, a workflow and a loop differ in who decides/,
  );
  assert.match(html, /\[<a href="\/sources\/#anthropic-building-effective-agents"[^>]*class="cite">1<\/a>\]/);
  assert.match(
    html,
    /<section class="chapter-sources"[^>]*><h2 id="sources">Sources<\/h2><ol><li><a href="\/sources\/#anthropic-building-effective-agents">Building effective agents<\/a>, Anthropic<\/li><\/ol><\/section>/,
  );
});

test("a chapter page shows a listing cut from a verify/ example, with the pin its harness's package.json holds", () => {
  const html = chapter();
  const manifest = JSON.parse(readFileSync(join(app, "../../verify/vercel-ai-sdk/package.json"), "utf8"));
  assert.match(html, /<a href="\/call-workflow-loop\/#lst-one-call" class="xref">Listing 1\.1<\/a> makes one call/);
  assert.match(
    html,
    /<span class="listing__number number">Listing 1\.1<\/span><span class="listing__title">One model call/,
  );
  assert.ok(html.includes('<span class="listing__path">verify/vercel-ai-sdk/examples/01-generate-text.ts</span>'));
  assert.ok(html.includes(`<span class="listing__pin">ai@${manifest.dependencies.ai}</span>`));
  assert.match(
    html,
    /<span class="line__number" aria-hidden="true">9<\/span><span class="tok-keyword">const<\/span> \{ model, requests \}/,
  );
});

test("the contents list every chapter in the outline, linking only the written ones", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.equal((html.match(/class="contents__chapter"/g) ?? []).length, 18);
  assert.match(html, /<a href="\/call-workflow-loop\/">Use the least autonomy that works/);
  assert.match(html, /<span class="contents__planned">Tools: schemas/);
});

test("the site header links to the glossary and the sources, and both pages exist", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /<a href="\/glossary\/">Glossary<\/a>/);
  assert.match(html, /<a href="\/sources\/">Sources<\/a>/);
  assert.match(readFileSync(join(out, "glossary", "index.html"), "utf8"), /<dt id="agent-loop">/);
  assert.match(
    readFileSync(join(out, "sources", "index.html"), "utf8"),
    /<li id="anthropic-building-effective-agents">/,
  );
});

test("a chapter inlines its generated figure on a scrolling panel, named for screen readers, with no font or style", () => {
  const html = chapter();
  assert.match(
    html,
    /<figure id="fig-who-decides"[^>]*><div class="panel figure__panel"><div class="figure__stage figure__stage--scroll panel--grid" tabindex="0" role="group" aria-labelledby="fig-who-decides--caption"><svg [^>]*data-figure="who-decides" role="img" aria-label="Three columns of boxes/,
  );
  assert.match(html, /<p class="figure__scroll-hint">Scroll sideways to see the whole figure →<\/p>/);
  assert.match(html, /<figcaption class="figure__caption" id="fig-who-decides--caption">/);
  assert.match(html, /<g id="who-decides--loop">/);
  for (const { path, html: page } of pages()) assert.doesNotMatch(page, /data:font|<!-- Generated by/, path);
});

// The analogy figure's colours come only from fig-* classes and its note from .figure__breaks, both over tokens that
// tokens.css defines for each theme, so a page that shows it in one theme shows it in the other.
test("a chapter shows an analogy illustration with its caption link and break note, styled in both themes", () => {
  const html = chapter();
  assert.match(html, /<figure id="fig-ticket-rail" class="numbered figure"[^>]*data-analogy="kitchen-ticket-rail">/);
  assert.match(html, /data-figure="ticket-rail" role="img" aria-label="Three order tickets hang from a rail\./);
  assert.match(
    html,
    / \(<a href="#fig-ticket-rail--breaks" class="figure__breaks-link">where the analogy breaks<\/a>\)/,
  );
  assert.match(
    html,
    /<p id="fig-ticket-rail--breaks" class="figure__breaks"><span class="label">Where it breaks<\/span> A cook/,
  );
  const css = files(".css")
    .map((path) => readFileSync(join(out, path), "utf8"))
    .join("\n");
  assert.match(css, /\.figure__breaks\{[^}]*color:var\(--color-text-soft\)/);
  assert.match(css, /\.fig-paper\{[^}]*fill:var\(--panel-background\)/);
  assert.match(css, /\[data-theme=dark\]\{[^}]*--color-text-soft:#d9c9b6[^}]*--panel-background:#17110d/);
});

test("the gallery shows the generated figure once per theme, each copy with its own ids", () => {
  const html = gallery();
  assert.match(html, /<g id="light-who-decides--loop">/);
  assert.match(html, /<g id="dark-who-decides--loop">/);
  assert.match(html, /tabindex="0" role="group" aria-labelledby="light-figure-generated-caption"/);
});

// The content security policy in public/_headers, as the deploy serves it from main. Each directive's sources, by
// directive name.
function policy(): Map<string, string[]> {
  const headers = readFileSync(join(app, "public", "_headers"), "utf8");
  const line = headers.split("\n").find((text) => text.trim().startsWith("Content-Security-Policy:")) ?? "";
  const directives = line.slice(line.indexOf(":") + 1).split(";");
  return new Map(
    directives
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name = "", ...sources]) => [name, sources]),
  );
}

test("the built site carries main's _headers and a 404 page for not_found_handling", () => {
  assert.equal(readFileSync(join(out, "_headers"), "utf8"), readFileSync(join(app, "public", "_headers"), "utf8"));
  assert.match(readFileSync(join(out, "404.html"), "utf8"), /<h1 class="chapter-head__title">Page not found<\/h1>/);
  assert.match(readFileSync(join(out, "404.html"), "utf8"), /<meta name="robots" content="noindex">/);
});

test("every response asks for HTTPS for a year, subdomains included, without joining the preload list", () => {
  const headers = readFileSync(join(app, "public", "_headers"), "utf8");
  const all = headers.slice(headers.indexOf("\n/*\n"), headers.indexOf("\n/_astro/*"));
  assert.match(all, /^ {2}Strict-Transport-Security: max-age=31536000; includeSubDomains$/m);
  const rules = headers
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  assert.doesNotMatch(rules, /preload/);
  for (const name of ["X-Content-Type-Options: nosniff", "Referrer-Policy: strict-origin-when-cross-origin"]) {
    assert.ok(all.includes(`  ${name}\n`), name);
  }
});

test("the content security policy allows only the book's own origin, with no inline code", () => {
  const csp = policy();
  assert.deepEqual(csp.get("default-src"), ["'none'"]);
  assert.deepEqual(csp.get("script-src"), ["'self'", "'wasm-unsafe-eval'"]);
  // Pagefind's stylesheet draws its search icon as a data: SVG.
  assert.deepEqual(csp.get("img-src"), ["'self'", "data:"]);
  for (const name of ["style-src", "font-src", "connect-src", "worker-src", "form-action"]) {
    assert.deepEqual(csp.get(name), ["'self'"], name);
  }
  assert.deepEqual(csp.get("base-uri"), ["'none'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  for (const [name, sources] of csp) {
    for (const source of sources) {
      assert.doesNotMatch(source, /^'(unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic)'$|^'(sha|nonce)/, source);
      // A scheme or host would let another origin in; img-src's data: is the one exception.
      if (!(name === "img-src" && source === "data:")) assert.doesNotMatch(source, /:/, `${name} ${source}`);
    }
  }
});

// What a browser would block under that policy: an inline style attribute or event handler, a javascript: URL, an
// object or frame, or a form that posts elsewhere. The inline <script> and <style> rules are the tests above.
test("no built page holds markup the content security policy would block", () => {
  for (const { path, html } of pages()) {
    assert.doesNotMatch(html, /<[a-z][^>]*\sstyle=/i, `${path}: an inline style attribute`);
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+=/i, `${path}: an inline event handler`);
    assert.doesNotMatch(html, /\s(href|src|action|formaction)="\s*javascript:/i, `${path}: a javascript: URL`);
    assert.doesNotMatch(html, /<(object|embed|iframe|frame|base)\b/i, `${path}: an element the policy blocks`);
    for (const [, action = ""] of html.matchAll(/<form\b[^>]*\saction="([^"]*)"/g)) {
      assert.match(action, /^\/[^/]/, `${path}: a form posts to ${action}`);
    }
  }
});

// Pagefind writes its files after astro build, so this build has none; the policy's worker-src and 'wasm-unsafe-eval'
// are for its pagefind-worker.js and its WebAssembly index.
test("every script the pages load is a same-origin file", () => {
  for (const { path, html } of pages()) {
    for (const [, src = ""] of html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)) {
      assert.match(src, /^\/[^/]/, `${path}: ${src}`);
      if (src.startsWith("/pagefind/")) continue;
      assert.ok(existsSync(join(out, src)), `${path} loads ${src}, which the build does not write`);
    }
  }
});
