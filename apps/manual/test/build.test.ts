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
// The build reads one fixture chapter, written as Chapter 1, through BOOK_FIXTURE_DIR, so the checks below stay
// fixed while the book's own chapters change.
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

test("the gallery shows the page line in its three states", () => {
  const html = gallery();
  for (const line of [
    /Listings on this page are verified against mock models; not yet compared with live APIs\./,
    /Listings on this page are verified against mock models; last compared with live APIs on\s*<time datetime="2026-12-01">1 December 2026<\/time>\./,
    /Listings on this page are verified against mock models only\./,
  ]) {
    assert.match(html, line);
  }
});

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

test("a chapter page's sidebar holds two navigation landmarks, its headings before the whole contents", () => {
  const html = chapter();
  assert.match(
    html,
    /<div class="sidebar"><nav class="sidebar__section sidebar__on-page" aria-label="On this page"><h2 class="sidebar__heading label">On this page<\/h2><ol class="sidebar__toc"><li><a href="#/,
  );
  assert.match(
    html,
    /<nav class="sidebar__section sidebar__chapters" aria-label="All chapters"><details><summary>All chapters<\/summary>/,
  );
  // The sidebar comes before the article, so the page's navigation keeps its place in the reading and tab order.
  assert.ok(html.indexOf('class="sidebar"') < html.indexOf('class="article"'));
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
  // The live run compares none of this chapter's files, so each listing and the page say only mock models verify them.
  assert.ok(html.includes('<span class="listing__verified">Verified against mock models only</span>'));
  assert.match(
    html,
    /<p class="listing-verification"[^>]*>\s*Listings on this page are verified against mock models only\.\s*<\/p>/,
  );
  assert.doesNotMatch(html, /compared with live APIs/);
  assert.match(
    html,
    /<span class="line__number" aria-hidden="true">9<\/span><span class="tok-keyword">const<\/span> \{ model, requests \}/,
  );
});

test("a chapter page builds with inline code that its listings and their packages' .d.ts files hold", () => {
  const html = chapter();
  // `generateText` and `result.finishReason` are in the listed region, and `stopWhen` and `Agent` in the tabs'
  // regions; only the .d.ts of ai, which the listed file imports, exports `streamText`.
  assert.match(html, /makes one call with <code>generateText<\/code>, and <code>result\.finishReason<\/code> says/);
  assert.match(html, /<code>streamText<\/code> streams the answer instead/);
  assert.match(html, /where <code>stopWhen<\/code> and <code>Agent<\/code> set who decides/);
});

test("a chapter page shows SDK tabs and a replay that read in full without JavaScript, and loads their script", () => {
  const html = chapter();
  const tabs = html.slice(html.indexOf('<div class="tabs" data-label="SDK">'));
  assert.deepEqual(
    [...tabs.matchAll(/<h2 class="tabs__heading"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]),
    ["AI SDK", "OpenAI Agents SDK"],
  );
  assert.ok(tabs.includes('<span class="listing__path">verify/openai-agents-sdk/examples/02-function-tool.ts</span>'));
  const transcript = JSON.parse(
    readFileSync(join(app, "../../verify/vercel-ai-sdk/results/transcripts/01-generate-text.json"), "utf8"),
  );
  const replay = html.slice(
    html.indexOf('id="lst-one-call-replay"'),
    html.indexOf("</section>", html.indexOf('id="lst-one-call-replay"')),
  );
  assert.ok(
    replay.includes(
      ["verify/", "vercel-ai-sdk/", "results/", "transcripts/", "01-generate-text.json"]
        .map((part) => `<span class="replay__segment">${part}</span>`)
        .join(""),
    ),
    "the transcript's path wraps only between its names",
  );
  assert.match(
    replay,
    /<div class="replay__scroll" tabindex="0" role="group" aria-label="Events of Recorded run of Listing 1\.1" data-step-scroll(?:="")?>/,
  );
  const checks = transcript.events.filter((event: { kind: string }) => event.kind === "check").length;
  assert.equal((replay.match(/data-kind="check"/g) ?? []).length, checks, "every check of the run is listed");
  assert.match(replay, /data-step-controls[^>]* hidden/);
  assert.match(html, /<script type="module" src="\/_astro\/[^"]+\.js"><\/script>/, "the page loads its script by URL");
});

test('a box marked top has a level-2 title, listed in the page\'s "On this page"', () => {
  const html = chapter();
  assert.match(
    html,
    /<aside class="box" aria-labelledby="where-steps-go"><h2 class="box__heading" id="where-steps-go">/,
  );
  const toc = html.slice(
    html.indexOf('<ol class="sidebar__toc">'),
    html.indexOf("</ol>", html.indexOf("sidebar__toc")),
  );
  assert.match(
    toc,
    /<a href="#how-the-loop-stops">How the loop stops<\/a><\/li><li><a href="#where-steps-go">Where each step goes<\/a>/,
  );
});

test("the contents list every chapter in the outline, linking only the written ones", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.equal((html.match(/class="contents__chapter"/g) ?? []).length, 18);
  assert.match(html, /<a href="\/call-workflow-loop\/">Use the least autonomy that works/);
  assert.match(html, /<span class="contents__planned">Tools: schemas/);
});

test("the contents page holds the resume link hidden, with no address, inside a paragraph that keeps its height", () => {
  const html = readFileSync(join(out, "index.html"), "utf8");
  const slot = html.match(/<p class="resume" data-resume>[\s\S]*?<\/p>/)?.[0] ?? "";
  assert.ok(slot, "the contents page has the resume paragraph");
  const link = slot.match(/<a\b[^>]*>/)?.[0] ?? "";
  assert.match(link, /class="resume__link"/);
  assert.match(link, /data-resume-link/);
  assert.match(link, /\shidden(\s|>|=)/, "the link stays hidden until the script finds a place");
  assert.doesNotMatch(link, /\shref=/, "a hidden link has no address until the script sets one");
  assert.match(slot, /<span class="resume__action label">Resume reading <span data-resume-chapter><\/span><\/span>/);
  assert.match(slot, /<span class="resume__where" data-resume-where><\/span>/);
  assert.ok(html.indexOf("data-resume") < html.indexOf('class="contents"'), "the link sits above the contents");
  const css = files(".css")
    .map((path) => readFileSync(join(out, path), "utf8"))
    .join("\n");
  assert.match(css, /\.resume\{min-height:calc\(/, "the paragraph reserves the link's height");
});

test("a chapter page names its slug for the reading script, and every page loads that script as a same-origin module", () => {
  assert.match(chapter(), /<article class="article" data-pagefind-body data-reading-chapter="call-workflow-loop">/);
  for (const { path, html } of pages()) {
    assert.match(html, /<script type="module" src="\/scripts\/reading\.js"><\/script>/, path);
  }
  assert.ok(existsSync(join(out, "scripts", "reading.js")));
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

// Isometric figures (BK11): an HTML fragment inlined with no iframe, complete without JavaScript, and its motion in an
// external module. The content security policy tests below also cover their markup.

test("a chapter inlines each isometric figure whole, with its alt text, caption and stage, and no iframe", () => {
  const html = chapter();
  assert.doesNotMatch(html, /<iframe/);
  for (const [id, number, alt] of [
    ["tally-counter", "1.3", "A hand tally counter on a small bench"],
    ["loop-bench", "1.4", "An isometric bench with three stations"],
  ] as const) {
    assert.match(
      html,
      new RegExp(
        `<figure id="fig-${id}"[^>]*><div class="panel figure__panel"><div class="figure__stage figure__stage--scroll panel--grid" tabindex="0" role="group" aria-labelledby="fig-${id}--caption"><p class="visually-hidden">${alt}`,
      ),
    );
    assert.match(html, new RegExp(`<div class="iso-figure" data-figure="${id}"><div class="iso-plate">`));
    assert.match(html, new RegExp(`data-corner="fig">Figure ${number.replace(".", "\\.")}</span>`));
    assert.match(html, new RegExp(`<figcaption class="figure__caption" id="fig-${id}--caption">`));
  }
  // The first paint already shows the first step: its part lit and its readout written.
  assert.match(html, /data-corner="readout" data-readout="">step 1 of 3 · context<\/span>/);
  assert.match(html, /data-iso-step="0" data-iso-readout="step 1 of 3 · context"><g class="iso-solid" data-lit="">/);
  // The controls exist only once the external module builds them, so no dead button shows without JavaScript.
  assert.doesNotMatch(html, /iso-figure__controls/);
  for (const card of html.match(/<div class="iso-figure"[\s\S]*?<\/figure>/g) ?? [])
    assert.doesNotMatch(card, /<button/);
});

test("the gallery shows the isometric sample once per theme, each copy's ids prefixed", () => {
  const html = gallery();
  for (const theme of ["light", "dark"]) {
    assert.match(html, new RegExp(`<g data-part="context\\.lamp" id="${theme}-loop-bench--lamp-context"`));
    assert.match(html, new RegExp(`<g data-part="tool\\.lamp" id="${theme}-loop-bench--lamp-tool"`));
  }
});

test("every id on a chapter page is unique, the isometric figures' included", () => {
  const ids = [...chapter().matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.includes("loop-bench--lamp-model"), "the sample centerpiece's lamps carry ids");
  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    [],
  );
});

test("the isometric figures' motion ships as an external module, and their colours as the anatomy stylesheet", () => {
  const scripts = files(".js").map((path) => readFileSync(join(out, path), "utf8"));
  assert.ok(scripts.some((text) => text.includes("data-iso-step") && text.includes("prefers-reduced-motion")));
  const css = files(".css")
    .map((path) => readFileSync(join(out, path), "utf8"))
    .join("\n");
  assert.match(css, /--anatomy-paper:var\(--panel-background\)/);
  assert.match(css, /\.iso-fill\{fill:var\(--anatomy-paper\)/);
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

test("the theme toggle is an icon button whose name says what a press does, and the stylesheet picks the icon", () => {
  const html = gallery();
  const button = html.match(/<button[^>]*data-theme-toggle[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(button, /aria-label="Switch theme"/);
  assert.match(button, /theme-toggle__icon--sun/);
  assert.match(button, /theme-toggle__icon--moon/);
  assert.equal((button.match(/aria-hidden="true"/g) ?? []).length, 2, "each icon is hidden from screen readers");
  assert.doesNotMatch(button, />\s*Switch theme\s*</, "the button holds no visible text");
  const css = files(".css")
    .map((path) => readFileSync(join(out, path), "utf8"))
    .join("");
  assert.match(css, /\.theme-toggle\[data-mode=dark\] \.theme-toggle__icon--sun/);
  assert.match(css, /\.theme-toggle\[data-mode=light\] \.theme-toggle__icon--moon/);
});

test("every page ends with a footer whose links to the repository and the author's profiles open in a new window", () => {
  const links = [
    "https://github.com/laudebugs/buildanagent",
    "https://x.com/laudebugs",
    "https://github.com/laudebugs",
  ];
  for (const { path, html } of pages()) {
    const footer = html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)?.[0] ?? "";
    assert.ok(
      html.indexOf("</main>") < html.indexOf(footer) && footer !== "",
      `${path}: no footer after the main text`,
    );
    for (const href of links)
      assert.ok(footer.includes(`href="${href}"`), `${path}: the footer does not link to ${href}`);
    const anchors = footer.match(/<a\b[^>]*>/g) ?? [];
    assert.equal(anchors.length, links.length, `${path}: the footer holds ${anchors.length} links`);
    assert.equal(
      footer.match(/\(opens in a new window\)/g)?.length,
      links.length,
      `${path}: a footer link lacks the screen-reader hint`,
    );
    for (const anchor of anchors) {
      assert.match(anchor, /target="_blank"/, `${path}: ${anchor} does not open a new window`);
      assert.match(anchor, /rel="noopener noreferrer"/, `${path}: ${anchor} lacks rel="noopener noreferrer"`);
    }
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
