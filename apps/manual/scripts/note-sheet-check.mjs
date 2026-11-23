// Checks, in a touch-emulated browser at an iPhone 14's size, that the note popover is a compact bottom sheet and that
// its colour swatches draw a small focus ring.
//
// The sheet must be at most 55% of the viewport and sit on the viewport's bottom edge with the passage still visible
// above it. It must have no gap over 24px between its stacked sections and scroll inside itself. In a window as short
// as a phone with its keyboard open, its field and actions must be in view and the passage must still show. A closed
// sheet must be display:none and leave the page tappable; it must close by Escape, a tap outside and a swipe, and open
// again without a reload. A swatch's focus outline must hug a small target, with a touch screen and with a mouse.
//
// It runs in Chromium and, when it is installed, in WebKit (Safari's engine;
// `PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit`), and says so when WebKit is missing. A WebKit build is
// not a real iPhone: Safari's on-screen keyboard and visual viewport are not tested. Screenshots go to the folder named
// by --shots, at CSS pixel scale, from Chromium, with the file name prefix --prefix (before or after).
//
// It needs Playwright, a browser and a built book (`pnpm --filter @buildanagent/manual build`), so it is not part of
// `pnpm test`.
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

const { chromium, webkit, devices } = loadPlaywright();
const { server, origin } = await serveDist();
const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 14"];
const { width, height } = phone.viewport;
const failures = [];
const check = (condition, message) => {
  console.log(`${condition ? "ok" : "NOT OK"} - ${message}`);
  if (!condition) failures.push(message);
};

/**
 * Opens the popover on a fresh highlight, its passage centred at `at` of the window's height; `note` saves a note first
 * so the popover shows the saved-note view. A mouse clicks and a touch screen taps.
 */
async function openSheet(page, note, at = 0.5, { touch = true, length = 70 } = {}) {
  await page.goto(`${origin}/tools/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".notes-open");
  await selectIn(page, 2, 10, length);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar .notes-swatch--blue");
  await reopen(page, at, touch);
  if (note) {
    await page.fill(".notes-pop__field", note);
    await page.click(".notes-pop__act[data-action='save']");
    await page.waitForSelector(".notes-pop__note:not([hidden])");
  }
}

/** Taps (or clicks) the blue highlight with its passage centred at `at` of the window's height. */
async function reopen(page, at = 0.5, touch = true) {
  const p = await page.evaluate((fraction) => {
    const range = [...CSS.highlights.values()].flatMap((h) => [...h])[0];
    range.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = range.getClientRects()[0];
    scrollBy(0, rect.top + rect.height / 2 - fraction * innerHeight);
    const moved = range.getClientRects()[0];
    return { x: moved.left + Math.min(20, moved.width / 2), y: moved.top + moved.height / 2 };
  }, at);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await page.waitForSelector(".notes-pop:popover-open");
}

/** Sizes of the open popover: its box, its children's gaps, the swatch box, the passage's position and the overflow. */
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
      left: r.left,
      right: r.right,
      h: r.height,
      vh: innerHeight,
      vw: innerWidth,
      gaps,
      maxGap: Math.max(0, ...gaps.map((g) => g.gap)),
      passage: passage ?? null,
      swatch: { w: sw.width, h: sw.height },
      field: field ? { top: field.top, bottom: field.bottom } : null,
      actions: { top: actions.top, bottom: actions.bottom },
      overflowY: getComputedStyle(pop).overflowY,
    };
  });

/** The focused element's outline box (its box grown by the outline's width and offset), and whether it is a swatch. */
const focusRing = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const ring = s.outlineStyle === "none" ? 0 : parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    return {
      swatch: el.classList.contains("notes-swatch"),
      w: b.width + 2 * ring,
      h: b.height + 2 * ring,
      outline: `${s.outlineStyle} ${s.outlineWidth} offset ${s.outlineOffset}`,
    };
  });

/** Whether the closed popover is gone: display none, and the page, not the popover, takes a tap where the sheet was. */
const isGone = (page) =>
  page.evaluate(() => {
    const pop = document.querySelector(".notes-pop");
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight - 40);
    return {
      display: getComputedStyle(pop).display,
      open: pop.matches(":popover-open"),
      covered: !!hit?.closest(".notes-pop"),
    };
  });

/** Moves keyboard focus onto the first swatch the way a keyboard does, so :focus-visible applies. */
async function focusFirstSwatch(page) {
  await page.focus(".notes-pop .notes-swatch");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
}

async function runTouch(name, browser, scheme, shot) {
  const context = await browser.newContext({ ...phone, colorScheme: scheme });
  const page = await context.newPage();
  const snap = (label) =>
    shot && page.screenshot({ path: join(shots, `${prefix}-${scheme}-${label}.png`), scale: "css" });
  for (const state of ["add-note", "saved-note"]) {
    const label = `${name} ${scheme} ${state}`;
    await openSheet(page, state === "saved-note" ? "A short note on this passage." : "");
    await snap(state);
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
    check(m.swatch.w === 44 && m.swatch.h === 44, `${label}: a swatch is a 44x44 target (${m.swatch.w}x${m.swatch.h})`);

    await focusFirstSwatch(page);
    const ring = await focusRing(page);
    console.log(`  ${label}: focus ring ${JSON.stringify(ring)}`);
    check(ring.swatch, `${label}: the focused element is a swatch`);
    check(
      ring.w <= 56 && ring.h <= 56,
      `${label}: the focused swatch's outline box is at most 56x56 (${ring.w}x${ring.h})`,
    );
    if (state === "add-note") await snap("swatch-focus");

    // The on-screen keyboard, stood in for by a short window.
    await page.focus(".notes-pop__field:not([hidden]), .notes-pop__act");
    await page.setViewportSize({ width, height: 420 });
    await page.waitForTimeout(300);
    const k = await measure(page);
    await snap(`${state}-keyboard`);
    check(
      k.bottom <= k.vh + 1 && k.top >= 0,
      `${label}, 420px window: the sheet fits (${k.top}..${k.bottom} of ${k.vh})`,
    );
    check(k.actions.bottom <= k.vh + 1 && k.actions.top >= 0, `${label}, 420px window: the actions are in view`);
    if (k.field) check(k.field.top >= 0 && k.field.bottom <= k.vh + 1, `${label}, 420px window: the field is in view`);
    check(
      k.h <= 0.55 * k.vh + 1,
      `${label}, 420px window: the sheet is at most 55% of the window (${Math.round((100 * k.h) / k.vh)}%)`,
    );
    check(
      k.passage && k.passage.top >= 0 && k.passage.bottom <= k.top,
      `${label}, 420px window: the passage still shows above the sheet`,
    );
    await page.setViewportSize({ width, height });
    await page.keyboard.press("Escape");
  }

  // A passage low on the page, then the keyboard: the page scrolls so the passage clears the lifted sheet.
  await openSheet(page, "A short note on this passage.", 0.8);
  await page.setViewportSize({ width, height: 420 });
  await page.waitForTimeout(300);
  const low = await measure(page);
  check(
    low.passage && low.passage.top >= 0 && low.passage.bottom <= low.top,
    `${name} ${scheme}: a passage low on the page clears the sheet once the keyboard opens (${JSON.stringify(low.passage)} above ${low.top})`,
  );
  await page.setViewportSize({ width, height });

  // A passage of several lines, low on the page: the page scrolls so its last line clears the sheet, its first line stays
  // on the screen, and it scrolls once, on open, not again on later frames.
  await openSheet(page, "A short note on this passage.", 0.63, { length: 230 });
  await page.waitForTimeout(250);
  const multi = await measure(page);
  const lineCount = await page.evaluate(() => {
    const range = [...CSS.highlights.values()].flatMap((h) => [...h])[0];
    return range.getClientRects().length;
  });
  check(lineCount >= 3, `${name} ${scheme}: the test passage has at least three lines (${lineCount})`);
  check(
    multi.passage && multi.passage.top >= 0 && multi.passage.bottom <= multi.top,
    `${name} ${scheme}: a multi-line passage shows whole above the sheet (${JSON.stringify(multi.passage)} above ${multi.top})`,
  );
  const settled = await page.evaluate(() => scrollY);
  await page.waitForTimeout(300);
  check((await page.evaluate(() => scrollY)) === settled, `${name} ${scheme}: the page stops scrolling after it opens`);

  // Closing: every way shuts the popover for good (display none, page tappable) and it opens again without a reload.
  for (const how of ["Escape", "tap outside", "swipe"]) {
    await openSheet(page, "A short note on this passage.");
    for (let round = 0; round < 2; round++) {
      if (how === "Escape") await page.keyboard.press("Escape");
      else if (how === "tap outside") await page.touchscreen.tap(width / 2, 20);
      else {
        const grab = await page.evaluate(() => {
          const r = document.querySelector(".notes-pop__grab").getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.move(grab.x, grab.y);
        await page.mouse.down();
        await page.mouse.move(grab.x, grab.y + 140, { steps: 6 });
        await page.mouse.up();
      }
      await page.waitForTimeout(150);
      const gone = await isGone(page);
      check(
        gone.display === "none" && !gone.open && !gone.covered,
        `${name} ${scheme}: after ${how} (round ${round + 1}) the popover is display none and no longer covers the page (${JSON.stringify(gone)})`,
      );
      if (round === 0) await reopen(page);
    }
  }
  await openSheet(page, "A short note on this passage.");
  await page.click(".notes-pop__act[data-action='delete']");
  await page.waitForTimeout(150);
  const removed = await isGone(page);
  check(
    removed.display === "none" && !removed.covered,
    `${name} ${scheme}: after Remove the popover is display none and uncovering (${JSON.stringify(removed)})`,
  );

  // A sheet that something stretches (a height of the whole window) must still be a compact one, on the bottom edge.
  await openSheet(page, "A short note on this passage.");
  await page.addStyleTag({ content: ".notes-pop[data-sheet] { height: 100dvh; }" });
  const st = await measure(page);
  check(
    st.h <= 0.55 * st.vh,
    `${name} ${scheme}: a sheet given a full-window height stays at most 55% (${Math.round((100 * st.h) / st.vh)}%)`,
  );
  check(
    Math.abs(st.bottom - st.vh) <= 1,
    `${name} ${scheme}: a stretched sheet stays on the bottom edge (${st.bottom} of ${st.vh})`,
  );
  check(
    st.maxGap <= 24,
    `${name} ${scheme}: a stretched sheet keeps no gap over 24px (largest ${Math.round(st.maxGap)}px)`,
  );
  await context.close();
}

/** A desktop window with a mouse: the swatch is its small 24px target, and its focus ring hugs it, round. */
async function runDesktop(name, browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
  const page = await context.newPage();
  await openSheet(page, "", 0.5, { touch: false });
  const m = await measure(page);
  check(m.swatch.w === 24 && m.swatch.h === 24, `${name} desktop: a swatch is 24x24 (${m.swatch.w}x${m.swatch.h})`);
  await focusFirstSwatch(page);
  const ring = await focusRing(page);
  check(
    ring.swatch && ring.w === ring.h && ring.w <= 32,
    `${name} desktop: the focus ring hugs the swatch, round (${ring.w}x${ring.h})`,
  );
  await context.close();
}

/** Forced colours (Chromium only): the pressed colour's ring and a focused swatch's ring are still drawn. */
async function runForced(name, browser) {
  const context = await browser.newContext({ ...phone, forcedColors: "active" });
  const page = await context.newPage();
  await openSheet(page, "");
  const rings = await page.evaluate(() => {
    const pressed = document.querySelector(".notes-pop .notes-swatch[aria-pressed='true']");
    const s = getComputedStyle(pressed, "::before");
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  check(
    rings.style !== "none" && parseFloat(rings.width) >= 2,
    `${name} forced colours: the pressed colour keeps a ring (${JSON.stringify(rings)})`,
  );
  await focusFirstSwatch(page);
  const ring = await focusRing(page);
  check(
    ring.swatch && !ring.outline.startsWith("none"),
    `${name} forced colours: a focused swatch has an outline (${ring.outline})`,
  );
  await context.close();
}

const engines = [["chromium", chromium]];
const wk = await webkit
  .launch({ env: browserEnv })
  .then((b) => b)
  .catch(() => undefined);
if (wk) engines.push(["webkit", webkit]);
else console.log("SKIPPED - WebKit is not installed (PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit)");
await wk?.close();

for (const [name, engine] of engines) {
  const browser = await engine.launch({ env: browserEnv });
  for (const scheme of ["dark", "light"]) await runTouch(name, browser, scheme, name === "chromium" && shots);
  await runDesktop(name, browser);
  if (name === "chromium") await runForced(name, browser);
  await browser.close();
}

server.close();
assert.equal(failures.length, 0, `${failures.length} checks failed:\n${failures.join("\n")}`);
console.log("all note-sheet checks passed");
