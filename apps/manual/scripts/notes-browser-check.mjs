// Drives the reader's notes (public/scripts/notes.js) in a real Chromium against the built book: it picks a colour,
// opens the popover by a click, changes the colour, adds a note and finds its dot, shares a passage and follows the
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
import { tmpdir } from "node:os";
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
    const global = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), LANG: "C.UTF-8" },
    }).trim();
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

const browser = await chromium.launch({ env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), LANG: "C.UTF-8" } });
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

  // 6. A note gets a numbered dot right after its passage, and a click on the dot opens the popover.
  await selectIn(page, 2, 10, 70);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar >> text=Add note");
  await page.fill("#notes-field", "A private note that Share must not copy.");
  await page.click(".notes-dialog__form button[type='submit']");
  await page.click(".notes-dialog__head button");
  await page.waitForSelector("article .notes-dot", { state: "attached" });
  const dot = await page.evaluate(() => {
    const el = document.querySelector("article .notes-dot");
    const box = el.getBoundingClientRect();
    const article = document.querySelector("article").getBoundingClientRect();
    const style = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
    // The character before and after the dot, as the text the reader sees.
    const before = el.previousSibling;
    const next = el.nextSibling;
    const rect = (node, offset, length) => {
      const r = document.createRange();
      r.setStart(node, offset);
      r.setEnd(node, offset + length);
      return r.getBoundingClientRect();
    };
    const last = before && before.nodeType === 3 ? rect(before, before.data.length - 1, 1) : null;
    const first = next && next.nodeType === 3 && next.data.length > 0 ? rect(next, 0, 1) : null;
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      w: box.width,
      h: box.height,
      articleRight: article.right,
      raised: style.top,
      reach: [after.top, after.left, after.right, after.bottom],
      label: el.getAttribute("aria-label"),
      number: getComputedStyle(el, "::before").content,
      text: el.textContent,
      lastRight: last && last.right,
      lastMid: last && (last.top + last.bottom) / 2,
      firstLeft: first && first.left,
      firstMid: first && (first.top + first.bottom) / 2,
      sameLineAfter: first ? Math.abs((first.top + first.bottom) / 2 - (box.top + box.bottom) / 2) < 12 : true,
      focusable: el.tabIndex === 0,
    };
  });
  check(dot.label === "Note 1" && dot.text === "", `${name}: the dot is named "Note 1" and holds no text`);
  check(dot.focusable, `${name}: the dot can take keyboard focus`);
  check(dot.w >= 14 && dot.w <= 26 && dot.h >= 12 && dot.h <= 22, `${name}: the dot is about 16px (${dot.w}x${dot.h})`);
  check(
    dot.raised === "-0.5em" || parseFloat(dot.raised) < 0,
    `${name}: the dot is raised like a footnote mark (${dot.raised})`,
  );
  check(
    dot.reach.every((value) => value === "-14px"),
    `${name}: the target reaches 14px around the dot`,
  );
  check(dot.right <= dot.articleRight + 1, `${name}: the dot is not cut off at the article's right edge`);
  check(
    dot.lastRight === null || dot.lastRight <= dot.left + 1,
    `${name}: the dot sits after the last word, not on it`,
  );
  check(
    !dot.sameLineAfter || dot.firstLeft === null || dot.firstLeft >= dot.right - 1,
    `${name}: the dot sits on no following character (${dot.right} <= ${dot.firstLeft})`,
  );
  const scroll = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(
    scroll.scroll <= scroll.client,
    `${name}: the page does not scroll sideways (${scroll.scroll} <= ${scroll.client})`,
  );
  check(
    await page.evaluate(() => !document.querySelector("article").innerText.includes("1\u2060")),
    `${name}: the dot's number is not text in the article`,
  );
  await page.evaluate(() => document.querySelector("article .notes-dot").scrollIntoView({ block: "center" }));
  if (shots) await page.screenshot({ path: join(shots, `${name}-dot.png`) });
  await page.locator("article .notes-dot").click({ force: false });
  await page.waitForSelector(".notes-pop:popover-open");
  check((await page.textContent(".notes-pop__quote")).length > 10, `${name}: a click on the dot opens the popover`);
  await page.keyboard.press("Escape");
  await page.focus("article .notes-dot");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".notes-pop:popover-open");
  check(true, `${name}: Enter on the focused dot opens the popover`);
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
