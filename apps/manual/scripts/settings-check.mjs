// Checks the reading settings panel (T70: src/components/ReadingSettings.astro, public/scripts/reading-panel.js) in a
// real browser against the built book. It checks that:
//
// - the header's "Aa" button is shown, named, 36 to 44px square, with its icon centred;
// - a click and the keyboard open the panel, which focuses the checked pairing; Escape closes it and returns focus to
//   the button, and a click outside closes it on a desktop;
// - each pairing changes the computed font family of the chapter title and the body text at once, and each size step
//   the root font size, with the step's label;
// - the arrow keys move between the pairings and between the size steps, which stop at the ends;
// - a choice survives a reload with its attributes on <html> in the first animation frame, and Reset restores the
//   defaults and leaves nothing in localStorage;
// - on an iPhone 14 touch profile the panel is a modal bottom sheet inside the window, Tab stays inside it, it scrolls
//   inside itself on a short screen, and the header stays shown while it is open;
// - at 150% with the panel open, no sampled page scrolls sideways on the phone in any pairing, the header is one 52px
//   row, and the panel, the Notes button and the save control fit the window;
// - when localStorage exists but every write throws, the note reads "Not saved: this browser blocked storage" as soon as
//   the panel opens, a pick still applies to the page for that view, the note stays unsaved, and a reload is back at
//   Book; on a normal page the note reads "Saved on this device" after a pick;
// - opening the panel closes an open notes popover, since both are auto popovers;
// - axe-core finds no violation with the panel open on a desktop and on the phone.
//
// Then, against a test build that registers the offline worker on loopback (scripts/lib/offline-site.mjs, as
// check:offline does), it checks that picking a pairing makes the worker save that pairing's fonts (SAVE_FILES), that
// the pairing's fonts then render offline, and that "Save the manual for offline reading" saves all four pairings'
// fonts, so every pairing renders offline.
//
// It needs Playwright, Chromium and a built book (`pnpm --filter @buildanagent/manual build`), so it is not part of
// `pnpm test`. It runs in Chromium only: WebKit is not installed in the cloud sessions. --shots <folder> saves the
// desktop popover, the phone sheet, the phone sheet at 150% in Readable and the dark theme. --no-offline skips the
// offline part, which builds the book again.
//
//   node scripts/settings-check.mjs [--shots <folder>] [--no-offline]
//   (or: pnpm --filter @buildanagent/manual check:settings)
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSize } from "../public/scripts/save-offline.js";
import { browserEnv, loadPlaywright, serveDist } from "./lib/browser-check.mjs";
import { buildTestBook, offlineEnv, serveBook } from "./lib/offline-site.mjs";

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const shots = arg("--shots");
if (shots) mkdirSync(shots, { recursive: true });

const tokens = JSON.parse(readFileSync(new URL("../../../docs/design/book-tokens.json", import.meta.url), "utf8"));
const reading = tokens.font.reading;
const face = (name) => (name === "display" || name === "body" ? tokens.font[name] : reading.faces[name]);
const pairings = reading.pairings.map((pairing) => {
  const display = face(pairing.display);
  const body = face(pairing.body);
  return {
    id: pairing.id,
    label: pairing.label,
    display: display.cssFamily,
    body: body.cssFamily,
    files: [...new Set([...display.files, ...body.files].map((file) => file.src))],
    // The upright file of the heading face at the heading weight: the one the panel's "Aa" sample draws.
    sample: display.files.find((file) => {
      const [low, high = low] = file.weight.split(" ").map(Number);
      return file.style === "normal" && pairing.displayWeight >= low && pairing.displayWeight <= high;
    })?.src,
  };
});
const DEFAULT = reading.default;
const LARGEST = Math.max(...reading.sizes);

const CHAPTER = "/the-model-gateway/";
const SAMPLE = [CHAPTER, "/tools-at-scale/", "/approvals-guardrails-and-injection/"];

const { chromium, devices } = loadPlaywright();
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 14"];
const desktop = { viewport: { width: 1280, height: 900 } };
const failures = [];
let label = "";
const check = (condition, message) => {
  console.log(`${condition ? "ok" : "NOT OK"} - [${label}] ${message}`);
  if (!condition) failures.push(`[${label}] ${message}`);
};
const first = (family) => family?.split(",")[0]?.trim().replace(/^"|"$/g, "");
const near = (a, b, within = 0.5) => Math.abs(a - b) <= within;

const BUTTON = "[data-reading-button]";
const PANEL = "#reading-panel";

/** A context whose pages start with `values` in localStorage and record the attributes in the first frame. */
async function context(browser, options, values = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...options });
  await ctx.addInitScript((stored) => {
    if (!sessionStorage.getItem("__seeded")) {
      localStorage.clear();
      for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
      sessionStorage.setItem("__seeded", "1");
    }
    const read = () => ({
      font: document.documentElement?.getAttribute("data-reading-font"),
      size: document.documentElement?.getAttribute("data-reading-size"),
    });
    window.__reading = {};
    requestAnimationFrame(() => {
      window.__reading.frame = read();
    });
  }, values);
  return ctx;
}

async function open(ctx, origin, url) {
  const page = await ctx.newPage();
  await page.goto(`${origin}${url}`, { waitUntil: "load" });
  await page.waitForSelector(`${BUTTON}:not([hidden])`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const isOpen = (page) => page.evaluate((selector) => document.querySelector(selector).matches(":popover-open"), PANEL);
const settle = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))));
// The sheet slides up for 0.2s as it opens; a check of its box waits for the slide to end.
const slid = (page) => page.waitForTimeout(350);

const families = (page) =>
  page.evaluate(() => ({
    title: getComputedStyle(document.querySelector("h1")).fontFamily,
    text: getComputedStyle([...document.querySelectorAll(".article > p")].find((p) => p.textContent.length > 200))
      .fontFamily,
    root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    font: document.documentElement.getAttribute("data-reading-font"),
    size: document.documentElement.getAttribute("data-reading-size"),
    stored: [localStorage.getItem("manual-reading-font"), localStorage.getItem("manual-reading-size")],
    label: document.querySelector("[data-reading-size-label]").textContent.trim(),
  }));

const focused = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return element?.matches("[data-reading-button]")
      ? "button"
      : element?.name
        ? `${element.name}=${element.value}`
        : (element?.getAttribute("data-reading-close") !== null && "close") || element?.tagName;
  });

async function axe(page, name) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(() =>
    axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }),
  );
  const bad = result.violations.map((v) => `${v.id} (${v.nodes.map((node) => node.target.join(" ")).join("; ")})`);
  check(bad.length === 0, `${name}: axe-core finds no violation${bad.length ? `: ${bad.join(", ")}` : ""}`);
}

async function desktopChecks(browser, origin) {
  label = "desktop";
  const ctx = await context(browser, desktop);
  const page = await open(ctx, origin, CHAPTER);
  const button = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    const box = element.getBoundingClientRect();
    const icon = element.querySelector("svg").getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      label: element.getAttribute("aria-label"),
      expanded: element.getAttribute("aria-expanded"),
      controls: element.getAttribute("aria-controls"),
      dx: icon.left + icon.width / 2 - (box.left + box.width / 2),
      dy: icon.top + icon.height / 2 - (box.top + box.height / 2),
    };
  }, BUTTON);
  check(
    button.width >= 36 && button.width <= 44 && button.height >= 36 && button.height <= 44,
    `the button is 36 to 44px square (${button.width} x ${button.height})`,
  );
  check(near(button.dx, 0, 1) && near(button.dy, 0, 1), `its icon is centred (${button.dx}, ${button.dy})`);
  check(
    button.label === "Reading settings" && button.expanded === "false" && button.controls === "reading-panel",
    "it is named Reading settings, collapsed, and controls the panel",
  );

  // A click opens the panel under the button, with focus on the checked pairing.
  await page.click(BUTTON);
  await settle(page);
  check(await isOpen(page), "a click opens the panel");
  const placed = await page.evaluate(
    ([b, p]) => {
      const box = document.querySelector(b).getBoundingClientRect();
      const panel = document.querySelector(p);
      const rect = panel.getBoundingClientRect();
      return {
        top: rect.top - box.bottom,
        right: Math.abs(rect.right - box.right),
        inside: rect.left >= 0 && rect.right <= document.documentElement.clientWidth && rect.bottom <= innerHeight,
        sheet: panel.hasAttribute("data-sheet"),
        modal: panel.getAttribute("aria-modal"),
        expanded: document.querySelector(b).getAttribute("aria-expanded"),
      };
    },
    [BUTTON, PANEL],
  );
  check(
    placed.top >= 0 && placed.top <= 12 && placed.right <= 1,
    `it hangs under the button (${placed.top}px down, ${placed.right}px off its right edge)`,
  );
  check(placed.inside && !placed.sheet && placed.modal === null, "it is a popover inside the window, not modal");
  check(placed.expanded === "true", "the button says the panel is expanded");
  check(
    (await focused(page)) === `reading-font=${DEFAULT}`,
    `focus is on the checked pairing (${await focused(page)})`,
  );
  await axe(page, "the open popover");
  if (shots) await page.screenshot({ path: join(shots, "settings-desktop-popover.png") });

  // Each pairing applies at once.
  for (const pairing of pairings) {
    label = `desktop ${pairing.id}`;
    await page.click(`${PANEL} input[name='reading-font'][value='${pairing.id}'] + .reading-panel__dot`);
    await page.evaluate(() => document.fonts.ready);
    const seen = await families(page);
    check(first(seen.title) === pairing.display, `the title is set in ${pairing.display} (${seen.title})`);
    check(first(seen.text) === pairing.body, `the body text is set in ${pairing.body} (${seen.text})`);
    const expected = pairing.id === DEFAULT ? null : pairing.id;
    check(
      seen.font === expected && seen.stored[0] === expected,
      `the choice is on <html> and stored (${seen.stored[0]})`,
    );
    check(await isOpen(page), "the panel stays open");
  }

  // Each size applies at once, with its label.
  label = "desktop sizes";
  const names = { 90: "Small", 100: "Default", 115: "Large", 130: "Larger", 150: "Largest" };
  for (const size of reading.sizes) {
    await page.click(`${PANEL} input[name='reading-size'][value='${size}'] + .reading-panel__stop`);
    const seen = await families(page);
    check(near(seen.root, (16 * size) / 100, 0.01), `${size}% sets the root to ${(16 * size) / 100}px (${seen.root})`);
    check(seen.label === `${size}% · ${names[size]}`, `the label reads "${seen.label}"`);
  }
  const panelWidth = await page.evaluate((p) => document.querySelector(p).getBoundingClientRect().width, PANEL);
  await page.click(`${PANEL} input[name='reading-size'][value='100'] + .reading-panel__stop`);
  const defaultWidth = await page.evaluate((p) => document.querySelector(p).getBoundingClientRect().width, PANEL);
  check(near(panelWidth, defaultWidth), `the panel keeps its size at 150% (${panelWidth} against ${defaultWidth})`);

  // The arrow keys.
  label = "desktop keys";
  await page.focus(`${PANEL} input[name='reading-font'][value='${DEFAULT}']`);
  await page.keyboard.press("ArrowDown");
  check((await families(page)).font === pairings[1].id, `ArrowDown on a pairing picks ${pairings[1].id}`);
  await page.keyboard.press("ArrowUp");
  check((await families(page)).font === null, "ArrowUp goes back to the default");
  await page.focus(`${PANEL} input[name='reading-size']:checked`);
  await page.keyboard.press("ArrowRight");
  check((await families(page)).size === "115", "ArrowRight on the size picks 115%");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  check((await families(page)).size === String(LARGEST), "End then ArrowRight stays at the largest size");
  check((await focused(page)) === `reading-size=${LARGEST}`, "focus follows the size step");
  await page.keyboard.press("Home");
  check((await families(page)).size === "90", "Home picks the smallest size");

  // Escape closes and returns focus; the keyboard opens again.
  label = "desktop focus";
  await page.keyboard.press("Escape");
  await settle(page);
  check(!(await isOpen(page)), "Escape closes the panel");
  check((await focused(page)) === "button", "focus returns to the button");
  await page.keyboard.press("Enter");
  await settle(page);
  check(await isOpen(page), "Enter on the button opens the panel");
  check((await focused(page)) === `reading-font=${DEFAULT}`, "focus is on the checked pairing again");
  await page.mouse.click(300, 600);
  await settle(page);
  check(!(await isOpen(page)), "a click outside closes the panel");

  // The notes popover and the panel are both auto popovers, so opening one closes the other.
  label = "desktop notes";
  const notesOpen = await page.evaluate(() => {
    const pop = document.querySelector(".notes-pop");
    if (!pop) return null;
    pop.showPopover();
    return pop.matches(":popover-open");
  });
  check(notesOpen === true, "the chapter has a notes popover, shown here for the check");
  await page.click(BUTTON);
  await settle(page);
  check(
    (await isOpen(page)) && !(await page.evaluate(() => document.querySelector(".notes-pop").matches(":popover-open"))),
    "opening the reading settings closes the notes popover",
  );
  await page.keyboard.press("Escape");
  await settle(page);

  // Persistence across a reload, before the first paint, and Reset.
  label = "desktop reload";
  await page.click(BUTTON);
  await page.click(`${PANEL} input[name='reading-font'][value='slab'] + .reading-panel__dot`);
  await page.click(`${PANEL} input[name='reading-size'][value='130'] + .reading-panel__stop`);
  await page.reload({ waitUntil: "load" });
  const frame = await page.evaluate(() => window.__reading.frame);
  check(
    frame?.font === "slab" && frame?.size === "130",
    `the choice is on <html> in the first frame (${JSON.stringify(frame)})`,
  );
  await page.waitForSelector(`${BUTTON}:not([hidden])`);
  await page.click(BUTTON);
  const checked = await page.evaluate(
    (p) => [...document.querySelectorAll(`${p} input:checked`)].map((i) => i.value),
    PANEL,
  );
  check(checked.join() === "slab,130", `the panel shows the stored choice (${checked})`);
  await page.click("[data-reading-reset]");
  const reset = await families(page);
  check(
    reset.font === null && reset.size === null && reset.stored.every((value) => value === null),
    `Reset restores the defaults and stores nothing (${JSON.stringify(reset.stored)})`,
  );
  check(reset.label === "100% · Default", "the label is back at the default");

  // The dark theme.
  if (shots) {
    label = "desktop dark";
    const dark = await context(browser, { ...desktop, colorScheme: "dark" }, { "manual-reading-font": "sans" });
    const darkPage = await open(dark, origin, CHAPTER);
    await darkPage.click(BUTTON);
    await settle(darkPage);
    await darkPage.screenshot({ path: join(shots, "settings-desktop-dark.png") });
    await axe(darkPage, "the open popover in the dark theme");
    await dark.close();
  }
  await ctx.close();
}

async function storageFailureChecks(browser, origin) {
  label = "storage refuses writes";
  const NOTE = `${PANEL} .reading-panel__note`;
  const blocked = await browser.newContext({ serviceWorkers: "block", ...desktop });
  await blocked.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  const page = await open(blocked, origin, CHAPTER);
  await page.click(BUTTON);
  await settle(page);
  const note = () => page.locator(NOTE).textContent();
  check((await note()) === "Not saved: this browser blocked storage", "the note is unsaved as soon as the panel opens");
  await page.click(`${PANEL} input[name='reading-font'][value='sans'] + .reading-panel__dot`);
  const sans = await families(page);
  check(
    first(sans.title) === first(pairings.find((pairing) => pairing.id === "sans").display) && sans.font === "sans",
    `the pick applies to this view (${sans.title})`,
  );
  check((await note()) === "Not saved: this browser blocked storage", "the note stays unsaved after a pick");
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(`${BUTTON}:not([hidden])`);
  const reloaded = await families(page);
  check(reloaded.font === null && reloaded.stored.every((value) => value === null), "a reload is back at Book");
  await blocked.close();

  label = "storage works";
  const normal = await context(browser, desktop);
  const ok = await open(normal, origin, CHAPTER);
  await ok.click(BUTTON);
  await settle(ok);
  await ok.click(`${PANEL} input[name='reading-size'][value='130'] + .reading-panel__stop`);
  check((await ok.locator(NOTE).textContent()) === "Saved on this device", "a normal page says Saved after a pick");
  check(
    (await ok.evaluate(() => Object.keys(localStorage))).every((key) => key !== "manual-reading-probe"),
    "the probe leaves no key behind",
  );
  await normal.close();
}

async function phoneChecks(browser, origin) {
  label = "phone";
  const ctx = await context(browser, { ...iphone, deviceScaleFactor: 2 });
  const page = await open(ctx, origin, CHAPTER);
  const box = await page.evaluate((b) => {
    const rect = document.querySelector(b).getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, BUTTON);
  check(box.width >= 44 && box.height >= 44, `the button is a 44px target (${box.width} x ${box.height})`);
  // Scroll down so the header hides, then up so it shows, then open the panel and scroll again.
  await page.mouse.wheel(0, 1200);
  await settle(page);
  await page.evaluate(() => window.scrollBy(0, -200));
  await settle(page);
  check(
    !(await page.evaluate(() => document.documentElement.hasAttribute("data-header-hidden"))),
    "an upward scroll shows the header",
  );
  await page.tap(BUTTON);
  await slid(page);
  check(await isOpen(page), "a tap opens the panel");
  const sheet = await page.evaluate(
    ([b, p]) => {
      const panel = document.querySelector(p);
      const rect = panel.getBoundingClientRect();
      const header = document.querySelector(".site-header").getBoundingClientRect();
      return {
        sheet: panel.hasAttribute("data-sheet"),
        modal: panel.getAttribute("aria-modal"),
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        top: rect.top,
        headerBottom: header.bottom,
        width: innerWidth,
        height: innerHeight,
        expanded: document.querySelector(b).getAttribute("aria-expanded"),
      };
    },
    [BUTTON, PANEL],
  );
  check(sheet.sheet && sheet.modal === "true", "the panel is a modal sheet");
  check(
    near(sheet.left, 0) && near(sheet.right, sheet.width) && near(sheet.bottom, sheet.height, 1),
    `the sheet spans the window's foot (${sheet.left}-${sheet.right}, bottom ${sheet.bottom} of ${sheet.height})`,
  );
  check(sheet.top >= sheet.headerBottom, `the sheet stays below the header (${sheet.top} >= ${sheet.headerBottom})`);
  await page.evaluate(() => window.scrollBy(0, 800));
  await settle(page);
  await settle(page);
  check(
    !(await page.evaluate(() => document.documentElement.hasAttribute("data-header-hidden"))),
    "the header stays shown while the panel is open",
  );
  await axe(page, "the open sheet");
  if (shots) await page.screenshot({ path: join(shots, "settings-phone-sheet.png") });

  // A tap on a pairing applies it.
  await page.tap(`${PANEL} input[name='reading-font'][value='sans'] + .reading-panel__dot`);
  const seen = await families(page);
  check(first(seen.text) === "Inter" && seen.stored[0] === "sans", `a tap picks Sans (${seen.text})`);

  // Tab stays inside the sheet.
  await page.focus("[data-reading-reset]");
  await page.keyboard.press("Tab");
  check((await focused(page)) === "close", `Tab from Reset goes to Close (${await focused(page)})`);
  await page.keyboard.press("Shift+Tab");
  check(
    (await page.evaluate(() => document.activeElement?.hasAttribute("data-reading-reset"))) === true,
    "Shift+Tab goes back to Reset",
  );
  await page.tap("[data-reading-close]");
  await settle(page);
  check(!(await isOpen(page)), "Close closes the sheet");
  await ctx.close();

  // A short screen: the sheet scrolls inside itself.
  label = "phone short";
  const short = await context(browser, { ...iphone, viewport: { width: 390, height: 480 } });
  const shortPage = await open(short, origin, CHAPTER);
  await shortPage.tap(BUTTON);
  await slid(shortPage);
  const scroll = await shortPage.evaluate((p) => {
    const panel = document.querySelector(p);
    const rect = panel.getBoundingClientRect();
    const header = document.querySelector(".site-header").getBoundingClientRect();
    return {
      overflow: getComputedStyle(panel).overflowY,
      scrolls: panel.scrollHeight > panel.clientHeight,
      top: rect.top,
      bottom: rect.bottom,
      headerBottom: header.bottom,
      height: innerHeight,
    };
  }, PANEL);
  check(
    scroll.scrolls && scroll.overflow === "auto",
    `the sheet scrolls inside itself (${scroll.overflow}, ${scroll.scrolls})`,
  );
  check(
    scroll.top >= scroll.headerBottom && near(scroll.bottom, scroll.height, 1),
    `it fits between the header and the window's foot (${scroll.top}-${scroll.bottom} of ${scroll.height})`,
  );
  await short.close();
}

async function largeChecks(browser, origin) {
  for (const pairing of pairings) {
    label = `phone ${LARGEST}% ${pairing.id}`;
    const ctx = await context(
      browser,
      { ...iphone, deviceScaleFactor: 2 },
      { "manual-reading-font": pairing.id, "manual-reading-size": String(LARGEST) },
    );
    for (const url of SAMPLE) {
      const page = await open(ctx, origin, url);
      await page.tap(BUTTON);
      await slid(page);
      const measured = await page.evaluate(
        ([b, p]) => {
          const box = (element) => element.getBoundingClientRect();
          const header = document.querySelector(".site-header");
          const buttons = [...header.querySelectorAll(".site-header__tools .control")].filter((e) => box(e).width > 0);
          const panel = box(document.querySelector(p));
          const notes = document.querySelector(".notes-open");
          const save = document.querySelector("[data-save-offline]");
          const inside = (element) => !element || box(element).width === 0 || box(element).right <= innerWidth;
          return {
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
            header: box(header).height,
            row: buttons.every((e) => box(e).top >= 0 && box(e).bottom <= 52 && box(e).right <= innerWidth),
            buttons: buttons.length,
            button: buttons.some((e) => e.matches(b)),
            panel: panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight + 1,
            notes: inside(notes),
            save: inside(save),
          };
        },
        [BUTTON, PANEL],
      );
      check(
        measured.scroll <= measured.client,
        `${url} does not scroll sideways (${measured.scroll} in ${measured.client})`,
      );
      if (url === CHAPTER) {
        check(near(measured.header, 52), `the header is one 52px row (${measured.header})`);
        check(
          measured.row && measured.button && measured.buttons >= 4,
          `its ${measured.buttons} buttons sit in the row`,
        );
        check(measured.panel, "the open sheet fits the window");
        check(measured.notes && measured.save, "the Notes button and the save control fit the window");
        if (pairing.id === "readable") {
          await axe(page, `the sheet at ${LARGEST}% in Readable`);
          if (shots) await page.screenshot({ path: join(shots, `settings-phone-sheet-${LARGEST}-readable.png`) });
        }
      }
      await page.close();
    }
    await ctx.close();
  }
}

/** The offline part, against a test build whose worker registers on loopback. */
async function offlineChecks() {
  label = "offline";
  const env = offlineEnv();
  const work = mkdtempSync(join(tmpdir(), "manual-settings-check-"));
  const { dist, manifest } = await buildTestBook(work, env);
  const server = await serveBook(() => dist);
  const sizes = new Map(manifest.files.map((file) => [file.url, file.size]));
  const browser = await chromium.launch({ env });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "allow" });
    const page = await ctx.newPage();
    const failed = [];
    page.on("requestfailed", (request) => failed.push(new URL(request.url()).pathname));
    await page.goto(`${server.origin}${CHAPTER}`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const cached = () =>
      page.evaluate(async () => {
        const name = (await caches.keys()).find((key) => key.startsWith("manual-"));
        const cache = await caches.open(name);
        return (await cache.keys()).map((request) => new URL(request.url).pathname);
      });
    const optional = pairings.filter((pairing) => pairing.id !== DEFAULT);
    const before = new Set(await cached());
    for (const pairing of optional) {
      check(
        pairing.files.every((path) => !before.has(path)),
        `the shell holds none of ${pairing.label}'s fonts before the reader picks it`,
      );
    }

    // Pick Sans online: the worker saves its fonts, and the panel says so.
    const sans = pairings.find((pairing) => pairing.id === "sans");
    await page.click(BUTTON);
    await page.click(`${PANEL} input[name='reading-font'][value='sans'] + .reading-panel__dot`);
    await page.waitForFunction(() => document.querySelector("[data-reading-status]").textContent !== "", null, {
      timeout: 30_000,
    });
    const status = await page.locator("[data-reading-status]").textContent();
    const bytes = sans.files.reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
    check(
      status === `Sans's fonts are saved for offline reading (${formatSize(bytes)}).`,
      `the panel says Sans is saved, with its size ("${status}")`,
    );
    const afterSans = new Set(await cached());
    check(
      sans.files.every((path) => afterSans.has(path)),
      `SAVE_FILES cached Sans's ${sans.files.length} files`,
    );
    // The open panel draws each pairing's "Aa" in its heading face, so those upright files load and the worker keeps
    // them as it keeps any listed file a page loads; no other file of another pairing is fetched.
    const others = optional
      .filter((pairing) => pairing.id !== "sans")
      .flatMap((pairing) => pairing.files.filter((path) => path !== pairing.sample));
    check(
      others.every((path) => !afterSans.has(path)),
      `no other pairing's fonts were cached but the samples' faces (${others.filter((path) => afterSans.has(path))})`,
    );
    for (const pairing of optional) {
      const total = pairing.files.reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
      console.log(`  measured: ${pairing.label} saves ${pairing.files.length} files, ${total} bytes`);
    }

    // Offline: Sans still renders after a reload.
    await ctx.setOffline(true);
    await server.stop();
    failed.length = 0;
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const offline = await page.evaluate(() => ({
      text: getComputedStyle([...document.querySelectorAll(".article > p")].find((p) => p.textContent.length > 200))
        .fontFamily,
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
      errors: [...document.fonts].filter((f) => f.status === "error").map((f) => f.family.replace(/"/g, "")),
    }));
    check(first(offline.text) === "Inter", `offline, the body text is still set in Inter (${offline.text})`);
    check(
      offline.loaded.includes("Inter") && offline.loaded.includes("Space Grotesk"),
      `offline, Inter and Space Grotesk load from the cache (${[...new Set(offline.loaded)]})`,
    );
    check(
      offline.errors.length === 0 && failed.filter((path) => path.startsWith("/fonts/")).length === 0,
      `no font fails offline (${offline.errors}; ${failed})`,
    );

    // Online again: save the whole book, which takes every pairing's fonts.
    await server.start();
    await ctx.setOffline(false);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("[data-save-offline][data-state='not-saved']", { timeout: 30_000 });
    const detail = await page.locator("[data-save-offline-detail]").textContent();
    check(
      detail.startsWith(`The whole manual is ${formatSize(manifest.total.bytes)}.`),
      `the save control shows the whole list's size, every pairing's fonts included ("${detail.split(".")[0]}.")`,
    );
    console.log(`  measured: the whole list is ${manifest.total.files} files, ${manifest.total.bytes} bytes`);
    await page.click("[data-save-offline-primary]");
    await page.waitForSelector("[data-save-offline][data-state='saved']", { timeout: 120_000 });
    const all = new Set(await cached());
    check(
      optional.every((pairing) => pairing.files.every((path) => all.has(path))),
      "saving the manual cached all four pairings' fonts",
    );

    // Offline: every pairing renders.
    await ctx.setOffline(true);
    await server.stop();
    await page.reload({ waitUntil: "load" });
    for (const pairing of pairings) {
      await page.click(BUTTON);
      await page.click(`${PANEL} input[name='reading-font'][value='${pairing.id}'] + .reading-panel__dot`);
      await page.keyboard.press("Escape");
      await page.evaluate(() => document.fonts.ready);
      const seen = await page.evaluate(() => ({
        title: getComputedStyle(document.querySelector("h1")).fontFamily,
        errors: [...document.fonts].filter((f) => f.status === "error").map((f) => f.family),
        loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
      }));
      check(
        first(seen.title) === pairing.display &&
          seen.loaded.includes(pairing.display) &&
          seen.loaded.includes(pairing.body),
        `offline after saving, ${pairing.label} renders in ${pairing.display} and ${pairing.body}`,
      );
      check(seen.errors.length === 0, `offline, no face fails to load in ${pairing.label} (${seen.errors})`);
    }
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
    rmSync(work, { recursive: true, force: true });
    rmSync(env.HOME, { recursive: true, force: true });
  }
}

let browser;
try {
  browser = await chromium.launch({ env: browserEnv });
} catch (error) {
  console.error(`Chromium is not installed here (${String(error.message).split("\n")[0]})`);
  process.exit(1);
}
console.log("SKIPPED - WebKit: the settings check runs in Chromium only");
const { server, origin } = await serveDist();
for (const run of [desktopChecks, storageFailureChecks, phoneChecks, largeChecks]) {
  try {
    await run(browser, origin);
  } catch (error) {
    check(false, `the run stopped: ${error.message.split("\n")[0]}`);
  }
}
await browser.close();
server.close();
if (!process.argv.includes("--no-offline")) {
  try {
    await offlineChecks();
  } catch (error) {
    check(false, `the offline run stopped: ${error.message.split("\n")[0]}`);
  }
}
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll settings checks passed.");
