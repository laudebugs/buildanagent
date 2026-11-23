// Checks, in a touch-emulated Chromium at an iPhone 14's size, that the note popover is a compact bottom sheet and that
// its colour swatches draw a small focus ring. The sheet must be at most 55% of the viewport, sit on the viewport's
// bottom edge with the passage still visible above it, have no gap over 24px between its stacked sections and scroll
// inside itself, with its field and actions in view, when the window is as short as a phone with its keyboard open. A
// swatch's focus outline must hug a target of at most 56x56. Screenshots go to the folder named by --shots, in both
// themes, at CSS pixel scale, with the file name prefix --prefix (before or after).
//
// It needs Playwright, a Chromium and a built book (`pnpm --filter @buildanagent/manual build`), so it is not part of
// `pnpm test`. It cannot show what a real iOS Safari does with its on-screen keyboard and visual viewport.
//
//   node scripts/note-sheet-check.mjs [--shots <folder>] [--prefix <name>]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { browserEnv, loadPlaywright, selectIn, serveDist } from "./lib/browser-check.mjs";

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const shots = arg("--shots");
const prefix = arg("--prefix") ?? "after";
if (shots) mkdirSync(shots, { recursive: true });

const { chromium, devices } = loadPlaywright();
const { server, origin } = await serveDist();
const browser = await chromium.launch({ env: browserEnv });
const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 14"];
const { width, height } = phone.viewport;
const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? "ok" : "NOT OK"} - ${message}`);
  if (!condition) failures.push(message);
};

/** Opens the popover on a fresh highlight; `note` saves a note first so the popover shows the saved-note view. */
async function openSheet(page, note) {
  await page.goto(`${origin}/tools/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".notes-open");
  await selectIn(page, 2, 10, 70);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar .notes-swatch--blue");
  const point = async () =>
    page.evaluate(() => {
      const [range] = CSS.highlights.get("manual-hl-blue");
      range.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "instant" });
      const rect = range.getClientRects()[0];
      return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + rect.height / 2 };
    });
  const p = await point();
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForSelector(".notes-pop:popover-open");
  if (note) {
    await page.fill(".notes-pop__field", note);
    await page.click(".notes-pop__act[data-action='save']");
    await page.waitForSelector(".notes-pop__note:not([hidden])");
  }
}

/** Sizes of the open sheet: its box, its children's boxes, the swatch outline and the passage's position. */
const measure = (page) =>
  page.evaluate(() => {
    const pop = document.querySelector(".notes-pop");
    const r = pop.getBoundingClientRect();
    const kids = [...pop.children]
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== "none")
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { cls: el.className.split(" ")[0], top: b.top, bottom: b.bottom };
      });
    const gaps = kids.slice(1).map((k, i) => ({ between: `${kids[i].cls}->${k.cls}`, gap: k.top - kids[i].bottom }));
    // The passage is the one highlight range whose text is the popover's quotation.
    const quote = pop.querySelector(".notes-pop__quote").textContent;
    let passage;
    for (const highlight of CSS.highlights.values())
      for (const range of highlight) if (range.toString() === quote) passage = range.getClientRects()[0];
    const sw = document.querySelector(".notes-pop .notes-swatch").getBoundingClientRect();
    const field = pop.querySelector(".notes-pop__field:not([hidden])")?.getBoundingClientRect();
    const actions = pop.querySelector(".notes-pop__actions").getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      h: r.height,
      vh: innerHeight,
      gaps,
      maxGap: Math.max(0, ...gaps.map((g) => g.gap)),
      passage: passage ? { top: passage.top, bottom: passage.bottom } : null,
      swatch: { w: sw.width, h: sw.height },
      field: field ? { top: field.top, bottom: field.bottom } : null,
      actions: { top: actions.top, bottom: actions.bottom },
      scrolls: pop.scrollHeight > pop.clientHeight + 1,
      overflowY: getComputedStyle(pop).overflowY,
    };
  });

/** The focused swatch's outline box: its element box grown by the outline's width and offset. */
const focusRing = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const ring = s.outlineStyle === "none" ? 0 : parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    return {
      tag: el.className,
      w: b.width + 2 * ring,
      h: b.height + 2 * ring,
      outline: `${s.outlineStyle} ${s.outlineWidth} offset ${s.outlineOffset}`,
    };
  });

for (const scheme of ["dark", "light"]) {
  const context = await browser.newContext({ ...phone, colorScheme: scheme });
  const page = await context.newPage();
  const shot = (name) =>
    shots && page.screenshot({ path: join(shots, `${prefix}-${scheme}-${name}.png`), scale: "css" });
  for (const state of ["add-note", "saved-note"]) {
    const label = `${scheme} ${state}`;
    await openSheet(page, state === "saved-note" ? "A short note on this passage." : "");
    await shot(state);
    const m = await measure(page);
    console.log(`  ${label}: ${JSON.stringify(m)}`);
    check(
      m.h <= 0.55 * m.vh,
      `${label}: the sheet is at most 55% of the viewport (${Math.round((100 * m.h) / m.vh)}%)`,
    );
    check(
      Math.abs(m.bottom - m.vh) <= 1,
      `${label}: the sheet's bottom edge is the viewport's bottom (${m.bottom} vs ${m.vh})`,
    );
    check(m.passage && m.passage.bottom <= m.top, `${label}: the passage stays visible above the sheet`);
    check(m.maxGap <= 24, `${label}: no gap over 24px between its sections (largest ${Math.round(m.maxGap)}px)`);
    check(
      m.overflowY === "auto" || m.overflowY === "scroll",
      `${label}: the sheet scrolls inside itself (${m.overflowY})`,
    );

    // Keyboard focus on the first swatch: a ring that hugs a small target.
    await page.keyboard.press("Tab");
    await page.focus(".notes-pop .notes-swatch");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const ring = await focusRing(page);
    console.log(`  ${label}: focus ring ${JSON.stringify(ring)}`);
    check(
      ring.w <= 56 && ring.h <= 56,
      `${label}: the focused swatch's outline box is at most 56x56 (${ring.w}x${ring.h})`,
    );
    check(m.swatch.w === 44 && m.swatch.h === 44, `${label}: a swatch is a 44x44 target (${m.swatch.w}x${m.swatch.h})`);
    if (state === "add-note") await shot("swatch-focus");

    // The on-screen keyboard, stood in for by a short window.
    await page.focus(".notes-pop__field:not([hidden]), .notes-pop__act");
    await page.setViewportSize({ width, height: 420 });
    await page.waitForTimeout(300);
    const k = await measure(page);
    await shot(`${state}-keyboard`);
    check(
      k.bottom <= k.vh + 1 && k.top >= 0,
      `${label}, 420px window: the sheet fits (${k.top}..${k.bottom} of ${k.vh})`,
    );
    check(
      k.actions.bottom <= k.vh + 1 && k.actions.top >= 0,
      `${label}, 420px window: the actions are in view (${k.actions.top}..${k.actions.bottom})`,
    );
    if (k.field) check(k.field.top >= 0 && k.field.bottom <= k.vh + 1, `${label}, 420px window: the field is in view`);
    check(
      k.h <= 0.55 * k.vh + 1,
      `${label}, 420px window: the sheet is at most 55% of the window (${Math.round((100 * k.h) / k.vh)}%)`,
    );
    await page.setViewportSize({ width, height });
    await page.keyboard.press("Escape");
  }
  // A sheet that something stretches (a height of the whole window) must still be a compact one.
  await openSheet(page, "A short note on this passage.");
  await page.addStyleTag({ content: ".notes-pop[data-sheet] { height: 100dvh; top: 0; }" });
  const s = await measure(page);
  check(
    s.h <= 0.55 * s.vh,
    `${scheme}: a sheet given a full-window height stays at most 55% (${Math.round((100 * s.h) / s.vh)}%)`,
  );
  check(s.maxGap <= 24, `${scheme}: a stretched sheet keeps no gap over 24px (largest ${Math.round(s.maxGap)}px)`);
  await context.close();
}

await browser.close();
server.close();
assert.equal(failures.length, 0, `${failures.length} checks failed:\n${failures.join("\n")}`);
console.log("all note-sheet checks passed");
