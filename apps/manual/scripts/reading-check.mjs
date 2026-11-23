// Checks the reading settings' first part (T69) in a real browser against the built book: the early script, the four
// typeface pairings and the five text sizes, set through localStorage before each page loads, as the settings panel will
// set them. It checks that:
//
// - the attributes are on <html> in the first animation frame, which runs before the first paint, and already when the
//   parser adds <body>;
// - each pairing changes the computed font family of the chapter title, a section heading and the body text, and the
//   browser loads that pairing's faces;
// - each page requests only the chosen pairing's font files and the code face's, never another pairing's;
// - a stored value that is not one of the allowed ones, and storage that throws, leave the default;
// - each size step sets the root font size to 16px times its percent and makes the body text larger step by step;
// - at 150% on an iPhone 14 profile (390px), no sampled page scrolls sideways in any pairing, and the header stays one
//   52px row with the wordmark whole and every button inside the window;
// - on a 1280px desktop, at every size, the header stays one 56px row, each button keeps the height it has at 100%, the
//   search field is at least 8px shorter than the row and nothing in it overflows; and the wordmark's font size at
//   1024px is the same at every size, within 0.5px;
// - a chapter has no axe-core violation in each pairing at 150% on the phone, and at 100% on a desktop.
//
// The sample of pages is the contents page, the glossary and the three chapters with the most listings, figures and
// tables in the built book (counted when this check was written): the-model-gateway, tools-at-scale and
// approvals-guardrails-and-injection. --all checks every built page instead.
//
// It needs Playwright, Chromium and a built book (`pnpm --filter @buildanagent/manual build`), so it is not part of
// `pnpm test`. It runs in Chromium only: WebKit is not installed in the cloud sessions, so Safari's engine is not
// checked here. --shots <folder> also saves a chapter in each pairing at 100% on a desktop and Readable at 150% on the
// phone, named with --prefix (default after).
//
//   node scripts/reading-check.mjs [--all] [--shots <folder>] [--prefix <name>]
//   (or: pnpm --filter @buildanagent/manual check:reading)
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { browserEnv, dist, loadPlaywright, serveDist } from "./lib/browser-check.mjs";

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const shots = arg("--shots");
const prefix = arg("--prefix") ?? "after";
if (shots) mkdirSync(shots, { recursive: true });

const tokens = JSON.parse(readFileSync(new URL("../../../docs/design/book-tokens.json", import.meta.url), "utf8"));
const reading = tokens.font.reading;
const face = (name) => (name === "display" || name === "body" ? tokens.font[name] : reading.faces[name]);
const folderOf = (src) => src.split("/")[2];
const pairings = reading.pairings.map((pairing) => {
  const display = face(pairing.display);
  const body = face(pairing.body);
  return {
    id: pairing.id,
    display: display.cssFamily,
    body: body.cssFamily,
    folders: new Set([...display.files, ...body.files, ...tokens.font.code.files].map((file) => folderOf(file.src))),
  };
});
const allFolders = new Set(
  [tokens.font.display, tokens.font.body, tokens.font.code, ...Object.values(reading.faces)].flatMap((font) =>
    font.files.map((file) => folderOf(file.src)),
  ),
);

const CHAPTER = "/the-model-gateway/";
const SAMPLE = ["/", "/glossary/", CHAPTER, "/tools-at-scale/", "/approvals-guardrails-and-injection/"];
const pages = process.argv.includes("--all")
  ? [
      "/",
      ...readdirSync(dist, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && readdirSync(join(dist, entry.name)).includes("index.html"))
        .map((entry) => `/${entry.name}/`),
    ]
  : SAMPLE;

const { chromium, devices } = loadPlaywright();
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const { server, origin } = await serveDist();
const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 14"];
const desktop = { viewport: { width: 1280, height: 900 } };
const failures = [];
let label = "";
const check = (condition, message) => {
  console.log(`${condition ? "ok" : "NOT OK"} - [${label}] ${message}`);
  if (!condition) failures.push(`[${label}] ${message}`);
};
const first = (family) => family.split(",")[0]?.trim().replace(/^"|"$/g, "");

/**
 * A context whose pages start with `values` in localStorage (or with storage that throws), and record, before any page
 * script runs, the attributes in the first animation frame and when the parser adds <body>.
 */
async function context(browser, options, values) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...options });
  await ctx.addInitScript((stored) => {
    if (stored === "throws") {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("storage is off");
        },
      });
    } else {
      localStorage.clear();
      for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
    }
    // An init script runs before the document has its <html>, so the root is read when each record is taken.
    const read = () => ({
      font: document.documentElement?.getAttribute("data-reading-font"),
      size: document.documentElement?.getAttribute("data-reading-size"),
    });
    window.__reading = {};
    requestAnimationFrame(() => {
      window.__reading.frame = { ...read(), stylesheets: document.styleSheets.length };
    });
    new MutationObserver((records, observer) => {
      if (records.some((record) => [...record.addedNodes].some((node) => node.nodeName === "BODY"))) {
        window.__reading.body = read();
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  }, values);
  return ctx;
}

/** Opens `url` and returns the page and the font files it requested. */
async function open(ctx, url) {
  const page = await ctx.newPage();
  const fonts = new Set();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/fonts/")) fonts.add(path);
  });
  await page.goto(`${origin}${url}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  return { page, fonts };
}

const families = (page) =>
  page.evaluate(() => {
    // A section heading of the chapter's own text, not one that names a listing, tab, replay or figure.
    const notASection = ".tabs, .listing, .replay, .figure, [data-pagefind-ignore]";
    const family = (selector) => {
      const element = [...document.querySelectorAll(selector)].find((e) => e.closest(notASection) === null);
      return element ? getComputedStyle(element).fontFamily : null;
    };
    return {
      title: family("h1"),
      section: family(".article h2[id]"),
      text: getComputedStyle([...document.querySelectorAll(".article > p")].find((p) => p.textContent.length > 200))
        .fontFamily,
      code: getComputedStyle(document.querySelector("pre")).fontFamily,
      loaded: [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
    };
  });

async function axe(page, name) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(() =>
    axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }),
  );
  const bad = result.violations.map((v) => `${v.id} (${v.nodes.length})`);
  check(bad.length === 0, `${name}: axe-core finds no violation${bad.length ? `: ${bad.join(", ")}` : ""}`);
}

async function pairingChecks(browser) {
  for (const pairing of pairings) {
    label = `${pairing.id} desktop 100%`;
    const ctx = await context(browser, desktop, { "manual-reading-font": pairing.id });
    const { page, fonts } = await open(ctx, CHAPTER);
    const expected = pairing.id === reading.default ? null : pairing.id;
    const state = await page.evaluate(() => window.__reading);
    check(state.frame?.font === expected, `data-reading-font is ${expected} in the first frame (${state.frame?.font})`);
    check(state.body?.font === expected, `data-reading-font is ${expected} when <body> arrives (${state.body?.font})`);
    const seen = await families(page);
    check(first(seen.title) === pairing.display, `the chapter title is set in ${pairing.display} (${seen.title})`);
    check(first(seen.section) === pairing.display, `a section heading is set in ${pairing.display} (${seen.section})`);
    check(first(seen.text) === pairing.body, `the body text is set in ${pairing.body} (${seen.text})`);
    check(first(seen.code) === tokens.font.code.cssFamily, `listings keep the code face (${seen.code})`);
    for (const family of new Set([pairing.display, pairing.body])) {
      check(seen.loaded.includes(family) || seen.loaded.includes(`"${family}"`), `${family} has loaded`);
    }
    const folders = new Set([...fonts].map(folderOf));
    const others = [...folders].filter((folder) => !pairing.folders.has(folder));
    check(
      others.length === 0,
      `only this pairing's and the code face's fonts are requested (${[...fonts].join(", ")})`,
    );
    for (const folder of allFolders) {
      if (!pairing.folders.has(folder)) check(!folders.has(folder), `no ${folder} file is requested`);
    }
    if (pairing.id === reading.default) await axe(page, "a chapter");
    if (shots) {
      await page.screenshot({ path: join(shots, `${prefix}-${pairing.id}-desktop.png`) });
    }
    await ctx.close();
  }
}

async function fallbackChecks(browser) {
  for (const [name, values] of [
    ["unknown values", { "manual-reading-font": "Sans", "manual-reading-size": "120" }],
    ["storage that throws", "throws"],
  ]) {
    label = name;
    const ctx = await context(browser, desktop, values);
    const { page, fonts } = await open(ctx, CHAPTER);
    const attributes = await page.evaluate(() => [
      document.documentElement.getAttribute("data-reading-font"),
      document.documentElement.getAttribute("data-reading-size"),
    ]);
    check(attributes[0] === null && attributes[1] === null, `the page keeps the default (${attributes})`);
    const book = pairings.find((pairing) => pairing.id === reading.default);
    check(
      [...fonts].every((path) => book.folders.has(folderOf(path))),
      `only Book's fonts are requested (${[...fonts].join(", ")})`,
    );
    await ctx.close();
  }
}

async function sizeChecks(browser) {
  let previous = 0;
  for (const size of reading.sizes) {
    label = `size ${size}%`;
    const ctx = await context(browser, iphone, { "manual-reading-size": String(size) });
    const { page } = await open(ctx, CHAPTER);
    const expected = size === reading.defaultSize ? null : String(size);
    const state = await page.evaluate(() => window.__reading);
    check(state.frame?.size === expected, `data-reading-size is ${expected} in the first frame (${state.frame?.size})`);
    const measured = await page.evaluate(() => ({
      root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      // The first paragraph of running text, not a short note set smaller.
      text: Number.parseFloat(
        getComputedStyle([...document.querySelectorAll(".article > p")].find((p) => p.textContent.length > 200))
          .fontSize,
      ),
    }));
    check(
      Math.abs(measured.root - (16 * size) / 100) < 0.01,
      `the root font size is ${(16 * size) / 100}px (${measured.root})`,
    );
    check(measured.text > previous, `the body text grows with the step (${measured.text}px)`);
    previous = measured.text;
    await ctx.close();
  }
}

async function phoneChecks(browser) {
  const largest = Math.max(...reading.sizes);
  for (const pairing of pairings) {
    label = `${pairing.id} phone ${largest}%`;
    const ctx = await context(
      browser,
      { ...iphone, deviceScaleFactor: 2 },
      {
        "manual-reading-font": pairing.id,
        "manual-reading-size": String(largest),
      },
    );
    for (const url of pages) {
      const { page } = await open(ctx, url);
      const width = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      check(width.scroll <= width.client, `${url} does not scroll sideways (${width.scroll} in ${width.client})`);
      if (url === CHAPTER) {
        const header = await page.evaluate(() => {
          const box = (element) => element.getBoundingClientRect();
          const bar = document.querySelector(".site-header");
          const title = document.querySelector(".site-header__title");
          const controls = [...bar.querySelectorAll(".site-header__tools > *, .site-header__tools .control")].filter(
            (element) => box(element).width > 0,
          );
          return {
            height: box(bar).height,
            titleWhole: title.scrollWidth <= title.clientWidth,
            titleBox: { top: box(title).top, bottom: box(title).bottom },
            controls: controls.map((element) => ({
              top: box(element).top,
              bottom: box(element).bottom,
              right: box(element).right,
            })),
            width: innerWidth,
          };
        });
        check(Math.abs(header.height - 52) < 0.5, `the header is one 52px row (${header.height})`);
        check(header.titleWhole, "the wordmark shows whole, with no ellipsis");
        check(
          header.titleBox.top >= 0 && header.titleBox.bottom <= 52,
          `the wordmark sits inside the row (${JSON.stringify(header.titleBox)})`,
        );
        check(
          header.controls.length >= 3 &&
            header.controls.every((c) => c.top >= 0 && c.bottom <= 52 && c.right <= header.width),
          `the header's buttons sit in the row, inside the window (${header.controls.length})`,
        );
        await axe(page, `${url} on the phone`);
        if (shots && pairing.id === "readable") {
          await page.screenshot({ path: join(shots, `${prefix}-readable-${largest}-phone.png`) });
        }
      }
      await page.close();
    }
    await ctx.close();
  }
}

/** The header's boxes on a desktop at every size, measured against the 100% size. */
async function headerChecks(browser) {
  const measure = (page) =>
    page.evaluate(() => {
      const bar = document.querySelector(".site-header");
      const box = (element) => element.getBoundingClientRect();
      const sized = [...bar.querySelectorAll(".control, button, .search-box__input")]
        .filter((element) => box(element).width > 0)
        .map((element) => ({ name: element.className, height: Math.round(box(element).height * 100) / 100 }));
      const title = document.querySelector(".site-header__title");
      return {
        height: box(bar).height,
        sized,
        search: sized.find((item) => item.name.includes("search-box__input"))?.height ?? 0,
        overflow: bar.scrollWidth > bar.clientWidth || document.documentElement.scrollWidth > innerWidth,
        titleWhole: title.scrollWidth <= title.clientWidth,
        wordmark: Number.parseFloat(getComputedStyle(title).fontSize),
      };
    });
  let base;
  let baseWordmark;
  for (const size of [reading.defaultSize, ...reading.sizes.filter((step) => step !== reading.defaultSize)]) {
    label = `header desktop ${size}%`;
    const values = { "manual-reading-size": String(size) };
    const ctx = await context(browser, { viewport: { width: 1280, height: 800 } }, values);
    const { page } = await open(ctx, CHAPTER);
    const now = await measure(page);
    base ??= now;
    check(Math.abs(now.height - 56) < 0.5, `the header is one 56px row (${now.height})`);
    check(!now.overflow && now.titleWhole, "nothing in the header overflows");
    check(now.search > 0 && now.search <= now.height - 8, `the search field fits the row with room (${now.search}px)`);
    check(
      now.sized.length === base.sized.length &&
        now.sized.every((item, index) => Math.abs(item.height - base.sized[index].height) < 0.5),
      `each control keeps its height from 100% (${now.sized.map((item) => item.height)} against ${base.sized.map((item) => item.height)})`,
    );
    await ctx.close();
    const narrow = await context(browser, { viewport: { width: 1024, height: 800 } }, values);
    const opened = await open(narrow, CHAPTER);
    const { wordmark } = await measure(opened.page);
    baseWordmark ??= wordmark;
    check(Math.abs(wordmark - baseWordmark) < 0.5, `the wordmark is ${baseWordmark}px at 1024px wide (${wordmark})`);
    await narrow.close();
  }
}

let browser;
try {
  browser = await chromium.launch({ env: browserEnv });
} catch (error) {
  console.error(`Chromium is not installed here (${String(error.message).split("\n")[0]})`);
  server.close();
  process.exit(1);
}
console.log("SKIPPED - WebKit: the reading check runs in Chromium only");
for (const run of [pairingChecks, fallbackChecks, sizeChecks, headerChecks, phoneChecks]) {
  try {
    await run(browser);
  } catch (error) {
    check(false, `the run stopped: ${error.message.split("\n")[0]}`);
  }
}
await browser.close();
server.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll reading checks passed.");
