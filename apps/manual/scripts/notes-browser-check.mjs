// Drives the reader's notes (public/scripts/notes.js) in a real Chromium against the built book: it picks a colour,
// opens the popover by a click, changes the colour, adds a note and finds its marker, shares a passage and follows the
// copied link, removes a highlight, and checks that no page scrolls sideways at a phone width. It needs Playwright and
// a Chromium (the cloud sessions have both pre-installed) and a built book (`pnpm --filter @buildanagent/manual build`),
// so it is not part of `pnpm test`. Screenshots go to the folder named by --shots, at a device scale factor of 2.
//
//   node scripts/notes-browser-check.mjs [--shots <folder>]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : undefined;
if (shots) mkdirSync(shots, { recursive: true });

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const global = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(join(global, "x.js"))("playwright");
  }
}
const { chromium } = loadPlaywright();

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
  let file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file)) file = join(dist, "404.html");
  else if (statSync(file).isDirectory()) file = join(file, "index.html");
  response.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const CHAPTER = `${origin}/tools/`;

const browser = await chromium.launch();
const results = [];
const check = (condition, message) => {
  assert.ok(condition, message);
  results.push(message);
  console.log(`ok - ${message}`);
};

/** Selects `length` characters, from `from`, inside the first text node long enough in the n-th long paragraph. */
async function selectIn(page, paragraphIndex, from, length) {
  return page.evaluate(
    ([index, start, count]) => {
      const paragraph = [...document.querySelectorAll("article p")].filter((p) => p.textContent.trim().length > 200)[
        index
      ];
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      // A node a reader can select: long enough, shown, and not inside a hidden glossary card, code or a link.
      const usable = (text) =>
        text.data.length >= start + count &&
        !text.parentElement.closest("[aria-hidden='true'], [data-pagefind-ignore], code, a") &&
        text.parentElement.getClientRects().length > 0;
      while (node && !usable(node)) node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + count);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return range.toString();
    },
    [paragraphIndex, from, length],
  );
}

async function runAt(name, viewport, mobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) requests.push(request.url());
  });
  await page.goto(CHAPTER);
  await page.waitForSelector(".notes-open");
  check(await page.evaluate(() => CSS.highlights.size === 8), `${name}: eight highlight names are registered`);

  // 1. Pick a colour on the toolbar.
  const quote = await selectIn(page, 1, 20, 60);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar .notes-swatch--green");
  const greens = await page.evaluate(() => CSS.highlights.get("manual-hl-green").size);
  check(greens === 1, `${name}: a toolbar swatch highlights the selection in green`);

  // 2. Click the highlight: the popover opens with its colours.
  const point = await page.evaluate(() => {
    const [range] = CSS.highlights.get("manual-hl-green");
    range.startContainer.parentElement.scrollIntoView({ block: "center" });
    const rect = range.getClientRects()[0];
    return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  if (mobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await page.waitForSelector(".notes-pop:popover-open");
  check(
    (await page.textContent(".notes-pop__quote")).includes(quote.trim().slice(0, 20)),
    `${name}: a click opens the popover on its passage`,
  );
  check(
    (await page.getAttribute(".notes-pop [data-color='green']", "aria-pressed")) === "true",
    `${name}: the highlight's colour is pressed`,
  );
  if (shots) await page.screenshot({ path: join(shots, `${name}-popover.png`) });

  // 3. Change the colour.
  await page.click(".notes-pop [data-color='pink']");
  check(
    await page.evaluate(
      () => CSS.highlights.get("manual-hl-pink").size === 1 && CSS.highlights.get("manual-hl-green").size === 0,
    ),
    `${name}: the colour button recolours the highlight`,
  );
  check(
    await page.evaluate(() => JSON.parse(localStorage.getItem("manual-notes")).v === 2),
    `${name}: the first change stores version 2`,
  );

  // 4. Share copies a link that scrolls to the passage.
  await page.click(".notes-pop button[data-action='share']");
  await page.waitForFunction(() => document.querySelector(".notes-pop__message")?.textContent.includes("Copied"));
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(copied.includes(`#`) && copied.includes(":~:text="), `${name}: Share copies a quote and a text-fragment link`);
  const link = copied.split("\n").at(-1);
  const target = await context.newPage();
  await target.goto(link);
  await target.waitForTimeout(800);
  const scrolled = await target.evaluate(() => Math.round(scrollY));
  check(scrolled > 200, `${name}: the copied link scrolls to the passage (scrollY ${scrolled})`);
  await target.close();

  // 5. Remove closes the popover and deletes the highlight.
  await page.click(".notes-pop button[data-action='delete']");
  check(
    await page.evaluate(() => CSS.highlights.get("manual-hl-pink").size === 0),
    `${name}: Remove deletes the highlight`,
  );
  check(!(await page.locator(".notes-pop:popover-open").count()), `${name}: Remove closes the popover`);

  // 6. A note gets a marker outside the article, and a click on the marker opens the popover.
  await selectIn(page, 2, 10, 70);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar >> text=Add note");
  await page.fill("#notes-field", "A private note that Share must not copy.");
  await page.click(".notes-dialog__form button[type='submit']");
  await page.click(".notes-dialog__head button");
  await page.waitForSelector(".notes-marker", { state: "attached" });
  const marker = await page.evaluate(() => {
    const el = document.querySelector(".notes-marker");
    const box = el.getBoundingClientRect();
    const article = document.querySelector("article").getBoundingClientRect();
    return {
      inside: !document.querySelector("article").contains(el),
      left: box.left,
      right: box.right,
      articleLeft: article.left,
      articleRight: article.right,
      w: box.width,
      h: box.height,
      hidden: el.getAttribute("aria-hidden"),
    };
  });
  check(
    marker.inside && marker.hidden === "true",
    `${name}: the note's marker is outside the article and hidden from assistive technology`,
  );
  check(marker.w === 24 && marker.h === 24, `${name}: the marker's target is 24 by 24 CSS pixels`);
  check(
    marker.left >= marker.articleLeft - 1 && marker.right <= marker.articleRight + 1,
    `${name}: the marker stays inside the article's width`,
  );
  const scroll = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(
    scroll.scroll <= scroll.client,
    `${name}: the page does not scroll sideways (${scroll.scroll} <= ${scroll.client})`,
  );
  await page.evaluate(() => document.querySelector(".notes-marker").scrollIntoView({ block: "center" }));
  if (shots) await page.screenshot({ path: join(shots, `${name}-marker.png`) });
  await page.locator(".notes-marker").click({ force: false });
  await page.waitForSelector(".notes-pop:popover-open");
  check((await page.textContent(".notes-pop__quote")).length > 10, `${name}: a click on the marker opens the popover`);
  await page.click(".notes-pop button[data-action='share']");
  await page.waitForFunction(() => document.querySelector(".notes-pop__message")?.textContent.includes("Copied"));
  check(
    !(await page.evaluate(() => navigator.clipboard.readText())).includes("private note"),
    `${name}: Share leaves the note out`,
  );
  await page.keyboard.press("Escape");
  check(!(await page.locator(".notes-pop:popover-open").count()), `${name}: Escape closes the popover`);

  check(requests.length === 0, `${name}: the page made no request outside the book (${requests.join(", ") || "none"})`);
  await context.close();
}

try {
  await runAt("desktop", { width: 1280, height: 900 }, false);
  await runAt("phone", { width: 393, height: 852 }, true);
  console.log(`\n${results.length} checks passed`);
} finally {
  await browser.close();
  server.close();
}
