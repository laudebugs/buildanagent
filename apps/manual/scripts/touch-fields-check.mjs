// Checks, in a touch-emulated Chromium at an iPhone 14's size, that every text-entry control the manual shows has a
// computed font size of at least 16px. iOS Safari zooms the page when a field under 16px takes focus. It opens the
// note editor in the dialog and in the popover, the Notes dialog's export and share fields, the contents page's search
// box and the search page, and also checks that no page scrolls sideways, that the sheet fits above a short window (a
// stand-in for the on-screen keyboard) and that the viewport meta forbids no zoom. It needs Playwright and a Chromium
// and a built book (`pnpm --filter @buildanagent/manual build`), so it is not part of `pnpm test`; the static
// test/touch-fields.test.ts guards the stylesheet in `pnpm test`. It cannot show what a real iOS Safari does.
//
//   node scripts/touch-fields-check.mjs   (or: pnpm --filter @buildanagent/manual check:touch-fields)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const env = { PATH: process.env.PATH ?? "", HOME: tmpdir(), LANG: "C.UTF-8" };
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const global = execFileSync("npm", ["root", "-g"], { encoding: "utf8", env }).trim();
    return createRequire(join(global, "x.js"))("playwright");
  }
}
const { chromium, devices } = loadPlaywright();

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
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

const browser = await chromium.launch({ env });
const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 14"];
const context = await browser.newContext(phone);
const page = await context.newPage();
const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? "ok" : "NOT OK"} - ${message}`);
  if (!condition) failures.push(message);
};

/** Every input, textarea and select on the page, shown or not, with its computed font size. */
const readFields = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("input, textarea, select, [contenteditable]")]
      .filter(
        (el) =>
          !(el instanceof HTMLInputElement && ["hidden", "checkbox", "radio", "button", "submit"].includes(el.type)),
      )
      .map((el) => ({
        name: `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`,
        shown: el.getClientRects().length > 0,
        size: parseFloat(getComputedStyle(el).fontSize),
      })),
  );
async function checkFields(where, expectShown = []) {
  const fields = await readFields();
  console.log(`  ${where}: ${fields.map((f) => `${f.name}${f.shown ? "" : "(hidden)"}=${f.size}px`).join(", ")}`);
  for (const f of fields) check(f.size >= 16, `${where}: ${f.name} is at least 16px (${f.size}px)`);
  for (const name of expectShown)
    check(
      fields.some((f) => f.name === name && f.shown),
      `${where}: ${name} was open when measured`,
    );
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(widths[0] <= widths[1], `${where}: the page does not scroll sideways (${widths[0]} <= ${widths[1]})`);
}

async function select(paragraph, from, length) {
  await page.evaluate(
    ([index, start, count]) => {
      const p = [...document.querySelectorAll("article p")].filter((el) => el.textContent.trim().length > 200)[index];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (
        node &&
        !(
          node.data.length >= start + count &&
          !node.parentElement.closest("[aria-hidden='true'], [data-pagefind-ignore], code, a") &&
          node.parentElement.getClientRects().length > 0
        )
      )
        node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + count);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    [paragraph, from, length],
  );
}

// The viewport meta must not forbid zoom.
await page.goto(`${origin}/tools/`);
const meta = await page.getAttribute("meta[name='viewport']", "content");
check(!/maximum-scale|user-scalable/.test(meta), `the viewport meta forbids no zoom (${meta})`);
await page.waitForSelector(".notes-open");
await checkFields("chapter, nothing open");

// The note editor in the dialog.
await select(1, 20, 60);
await page.waitForSelector(".notes-toolbar:not([hidden])");
await page.click(".notes-toolbar >> text=Add note");
await page.waitForSelector("#notes-field", { state: "visible" });
await checkFields("note dialog", ["textarea.notes-dialog__field"]);
await page.fill("#notes-field", "A note.");
await page.click(".notes-dialog__form button[type='submit']");

// Its Export field.
await page.click("button:has-text('Export as Markdown')");
await page.waitForSelector("#notes-export", { state: "visible" });
await checkFields("export field", ["textarea.notes-dialog__field"]);
await page.click(".notes-dialog__head button");

// The note editor in the popover or sheet: a plain highlight's Add a note field.
await select(2, 10, 70);
await page.waitForSelector(".notes-toolbar:not([hidden])");
await page.click(".notes-toolbar .notes-swatch--blue");
const point = await page.evaluate(() => {
  const [range] = CSS.highlights.get("manual-hl-blue");
  range.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "instant" });
  const rect = range.getClientRects()[0];
  return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + rect.height / 2 };
});
await page.touchscreen.tap(point.x, point.y);
await page.waitForSelector(".notes-pop:popover-open");
await checkFields("popover sheet", ["textarea.notes-pop__field"]);

// A short window stands in for the on-screen keyboard: the sheet must still sit inside it and the page must not jump.
await page.focus(".notes-pop__field");
const before = await page.evaluate(() => scrollY);
await page.setViewportSize({ width: 390, height: 420 });
await page.waitForTimeout(300);
const fit = await page.evaluate(() => {
  const r = document.querySelector(".notes-pop").getBoundingClientRect();
  const actions = document.querySelector(".notes-pop__actions").getBoundingClientRect();
  return {
    top: r.top,
    bottom: r.bottom,
    left: r.left,
    right: r.right,
    actions: actions.bottom,
    h: innerHeight,
    w: innerWidth,
    y: scrollY,
  };
});
check(
  fit.left >= 0 && fit.right <= fit.w && fit.bottom <= fit.h + 1,
  `the sheet fits a 390x420 window (${JSON.stringify(fit)})`,
);
check(fit.actions <= fit.h + 1, "Save and Remove stay inside the short window");
check(Math.abs(fit.y - before) < 2, `the page does not jump when the window shortens (scrollY ${before} -> ${fit.y})`);
await page.setViewportSize({ width: 390, height: 844 });
await page.keyboard.press("Escape");

// The search box on the contents page and the search page (Pagefind's own field).
await page.goto(`${origin}/`);
await checkFields("contents page");
await page.goto(`${origin}/search/`);
await page.waitForSelector("pagefind-input input");
await checkFields("search page", ["input.pf-input"]);

await browser.close();
server.close();
assert.equal(failures.length, 0, `${failures.length} checks failed:\n${failures.join("\n")}`);
console.log("all touch-field checks passed");
