// Checks, in a touch-emulated Chromium at an iPhone 14's size, that every text-entry control the manual shows has a
// computed font size of at least 16px, because iOS Safari zooms the page when a smaller field takes focus. It opens the
// note editor in the dialog and in the popover, the Notes dialog's export and share fields, the contents page's search
// box and the search page. It also checks that no page scrolls sideways, that the sheet fits above a short window (a
// stand-in for the on-screen keyboard) and that the viewport meta forbids no zoom.
//
// It needs Playwright, a Chromium and a built book (`pnpm --filter @buildanagent/manual build`), so it is not part of
// `pnpm test`; the static test/touch-fields.test.ts guards the stylesheet there. It cannot show what a real iOS Safari
// does.
//
//   node scripts/touch-fields-check.mjs   (or: pnpm --filter @buildanagent/manual check:touch-fields)
import assert from "node:assert/strict";
import { browserEnv, loadPlaywright, selectIn, serveDist } from "./lib/browser-check.mjs";

const { chromium, devices } = loadPlaywright();
const { server, origin } = await serveDist();

const browser = await chromium.launch({ env: browserEnv });
const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 14"];
const { width, height } = phone.viewport;
const context = await browser.newContext(phone);
const page = await context.newPage();
const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? "ok" : "NOT OK"} - ${message}`);
  if (!condition) failures.push(message);
};

/**
 * Every text-entry control on the page, shown or not: each textarea and select, each input except the types that take
 * no typed text (hidden, checkbox, radio, button, submit, reset, image, range, color, file), and each element that is
 * contenteditable unless it says contenteditable="false".
 */
const readFields = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "input:not([type=hidden], [type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=image], [type=range], [type=color], [type=file]), textarea, select, [contenteditable]:not([contenteditable=false])",
      ),
    ].map((el) => ({
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

// The viewport meta must not forbid zoom.
await page.goto(`${origin}/tools/`);
const meta = await page.getAttribute("meta[name='viewport']", "content");
check(!/maximum-scale|user-scalable/.test(meta), `the viewport meta forbids no zoom (${meta})`);
await page.waitForSelector(".notes-open");
await checkFields("chapter, nothing open");

// The note editor in the dialog.
await selectIn(page, 1, 20, 60);
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
await selectIn(page, 2, 10, 70);
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
await page.setViewportSize({ width, height: 420 });
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
  `the sheet fits a ${width}x420 window (${JSON.stringify(fit)})`,
);
check(fit.actions <= fit.h + 1, "Save and Remove stay inside the short window");
check(Math.abs(fit.y - before) < 2, `the page does not jump when the window shortens (scrollY ${before} -> ${fit.y})`);
await page.setViewportSize({ width, height });
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
