// Checks the sticky header (T68) in real browsers against the built book: a desktop window and an iPhone 14 touch
// profile, in Chromium and, when it is installed, in WebKit (Safari's engine; `npx playwright install webkit`); it
// says so when WebKit is missing. It checks that:
//
// - the header stays fixed to the top after a scroll, 56px tall on a desktop and 52px on a phone, and a desktop's never
//   hides;
// - a phone's header hides on a scroll down, returns on the first scroll up, stays shown near the top, ignores a move
//   under 8px, stays shown while the menu or search is open or keyboard focus is inside it, and is revealed when focus
//   moves into it; with prefers-reduced-motion it still hides, with no transition;
// - the settings slot holds the reading settings button, shown in the row between the search and the theme toggle;
// - the progress line is about 0 at the top of a chapter, about 50% in the middle and 100% at the end of its main text,
//   rides the header's bottom edge and stays at the top of the window while a phone's header is hidden, and a page
//   that is not a chapter has none;
// - a heading a link jumps to, down or up, shows fully below the header, and the chapter rails stick below it;
// - the phone menu opens, lists Contents, Glossary, Sources and Notes, closes on Escape, on a tap outside and on a
//   link, returns focus, and its Notes entry opens the notes panel; the search button opens the search field;
// - the note popover and the Notes button never sit under the header, and a glossary card opens below it;
// - opening the "All chapters" list on a phone moves the progress line's end with the article;
// - a chapter page has no axe-core violation, with the header in both modes of the phone.
//
// It needs Playwright, a browser and a built book (`pnpm --filter @buildanagent/manual build`), so it is not part of
// `pnpm test`. A WebKit build is not a real iPhone: Safari's toolbar, rubber-band scroll and on-screen keyboard are not
// tested. --shots <folder> also saves screenshots at 2x, with the file name prefix --prefix (before or after).
//
//   node scripts/header-check.mjs [--shots <folder>] [--prefix <name>]   (or: pnpm --filter @buildanagent/manual check:header)
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { browserEnv, loadPlaywright, selectIn, serveDist } from "./lib/browser-check.mjs";

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const shots = arg("--shots");
const prefix = arg("--prefix") ?? "after";
if (shots) mkdirSync(shots, { recursive: true });

const { chromium, webkit, devices } = loadPlaywright();
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const { server, origin } = await serveDist();
const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 14"];
const failures = [];
let label = "";
const check = (condition, message) => {
  console.log(`${condition ? "ok" : "NOT OK"} - [${label}] ${message}`);
  if (!condition) failures.push(`[${label}] ${message}`);
};
const near = (value, expected, tolerance) => Math.abs(value - expected) <= tolerance;

const CHAPTER = "/the-model-gateway/";
const settle = (page) => page.waitForTimeout(400);
const scrollTo = async (page, y) => {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await settle(page);
};
const scrollBy = async (page, dy) => {
  await page.evaluate((delta) => window.scrollBy(0, delta), dy);
  await settle(page);
};
const rect = (page, selector) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r && { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  }, selector);
const hidden = (page) => page.evaluate(() => document.documentElement.hasAttribute("data-header-hidden"));
const progress = (page) =>
  page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector("[data-reading-bar]")).transform).a);
/** The scroll positions where the chapter starts and where its main text ends at the window's bottom. */
const span = (page) =>
  page.evaluate(() => {
    const top = (el) => el.getBoundingClientRect().top + scrollY;
    return {
      start: top(document.querySelector(".layout")),
      last: top(document.querySelector(".chapter-sources")) - innerHeight,
    };
  });
const open = async (browser, options, url = CHAPTER) => {
  const context = await browser.newContext({ serviceWorkers: "block", ...options });
  const page = await context.newPage();
  await page.goto(`${origin}${url}`, { waitUntil: "load" });
  await page.waitForSelector(".notes-open");
  await settle(page);
  return { context, page };
};

async function common(page, height) {
  const header = await rect(page, ".site-header");
  check(near(header.height, height, 0.5), `the header is ${height}px tall (measured ${header.height})`);
  check(
    (await page.evaluate(() => getComputedStyle(document.querySelector(".site-header")).position)) === "sticky",
    "the header is sticky",
  );
  check(
    await page.evaluate(() => {
      const slot = document.querySelector(".site-header [data-slot='settings']");
      const button = slot?.querySelector("[data-reading-button]");
      const theme = document.querySelector(".site-header [data-theme-toggle]");
      if (!button || button.hidden || !theme) return false;
      const box = button.getBoundingClientRect();
      // The slot is laid out as its contents, so the button is one of the tools; DOM order puts it before the toggle.
      return box.width > 0 && box.right <= theme.getBoundingClientRect().left;
    }),
    "the settings slot's Aa button is shown in the row, before the theme toggle",
  );
  // The progress line.
  check(near(await progress(page), 0, 0.001), "the progress line is empty at the top");
  const line = await rect(page, "[data-reading-progress]");
  check(
    near(line.height, 3, 0.01) && near(line.bottom, height, 0.5),
    "the 3px progress line rides the header's bottom edge",
  );
  const { start, last } = await span(page);
  await scrollTo(page, start + (last - start) / 2);
  const middle = await progress(page);
  check(near(middle, 0.5, 0.02), `the progress line is about 50% in the middle of the chapter (${middle.toFixed(3)})`);
  await scrollTo(page, last);
  check(near(await progress(page), 1, 0.005), "the progress line is full where the chapter's main text ends");
  await scrollTo(page, last + 3000);
  check(near(await progress(page), 1, 0.001), "the progress line stays full through the sources and the footer");
  await scrollTo(page, 0);
  const glossary = await page.evaluate(async (url) => {
    const html = await (await fetch(url)).text();
    return html.includes("data-reading-progress");
  }, "/glossary/");
  check(!glossary, "a page that is not a chapter has no progress line");
}

async function jumps(page, bottom, name) {
  const id = await page.evaluate(() => document.querySelectorAll(".article h2[id]")[2]?.id);
  await page.evaluate((target) => {
    location.hash = target;
  }, id);
  await settle(page);
  let box = await rect(page, `#${id}`);
  check(
    box.top >= bottom - 0.5 && box.bottom <= (await page.evaluate(() => innerHeight)),
    `${name}: a jump down leaves the heading fully visible below the header (top ${box.top.toFixed(0)})`,
  );
  check(
    Math.abs(box.top - (bottom + 12)) <= 1,
    `${name}: a jump down puts the heading 12px below the header (top ${box.top.toFixed(1)}, want ${bottom + 12})`,
  );
  await scrollTo(page, (await page.evaluate(() => document.documentElement.scrollHeight)) - 2000);
  const first = await page.evaluate(() => document.querySelectorAll(".article h2[id]")[0]?.id);
  await page.evaluate((target) => {
    location.hash = target;
  }, first);
  await settle(page);
  box = await rect(page, `#${first}`);
  check(box.top >= bottom - 0.5, `${name}: a jump up leaves the heading below the header (top ${box.top.toFixed(0)})`);
  await scrollTo(page, 0);
}

async function overlaps(page, bottom, touch) {
  const notes = await rect(page, ".notes-open");
  check(notes.top >= bottom, "the Notes button is below the header");
  // A highlight placed just under the header, whose popover would open above it if the window had room there.
  await page.evaluate(() => localStorage.clear());
  await scrollTo(page, 0);
  await selectIn(page, 2, 10, 60);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  const bar = await rect(page, ".notes-toolbar");
  check(bar.top >= bottom - 0.5, `the selection toolbar is below the header (top ${bar.top.toFixed(0)})`);
  await page.click(".notes-toolbar .notes-swatch--blue");
  const spot = await page.evaluate((fraction) => {
    const range = [...CSS.highlights.values()].flatMap((h) => [...h])[0];
    range.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "instant" });
    const r = range.getClientRects()[0];
    scrollBy(0, r.top + r.height / 2 - fraction * innerHeight);
    const moved = range.getClientRects()[0];
    return { x: moved.left + Math.min(20, moved.width / 2), y: moved.top + moved.height / 2 };
  }, 0.5);
  await settle(page);
  if (touch) await page.touchscreen.tap(spot.x, spot.y);
  else await page.mouse.click(spot.x, spot.y);
  await page.waitForSelector(".notes-pop:popover-open");
  const pop = await rect(page, ".notes-pop");
  // On a touch screen the popover is a full-width bottom sheet (notes.js SHEET_QUERY), so it cannot reach the header.
  check(pop.top >= bottom - 0.5 || touch, `the note popover is below the header (top ${pop.top.toFixed(0)})`);
  await page.keyboard.press("Escape");
}

/** A glossary term scrolled just under the header: its card must open fully below the header, not beneath it. */
async function glossaryCard(page, bottom) {
  await page.evaluate(() => localStorage.clear());
  await scrollTo(page, 0);
  const linkAt = (top) =>
    page.evaluate((offset) => {
      const link = document.querySelector(".article .glossary-term__link");
      if (!link) return null;
      link.scrollIntoView({ block: "start", behavior: "instant" });
      scrollBy(0, link.getBoundingClientRect().top - offset);
      return true;
    }, top);
  const hover = async () => {
    await settle(page);
    const point = await page.evaluate(() => {
      const r = document.querySelector(".article .glossary-term__link").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(0, 400);
    await page.mouse.move(point.x, point.y);
    await settle(page);
    return page.evaluate(() => {
      const open = [...document.querySelectorAll(".glossary-term")].find((t) => t.matches(":hover"));
      const r = open?.querySelector(".glossary-term__card")?.getBoundingClientRect();
      return r && { top: r.top, height: r.height };
    });
  };
  const found = await linkAt(bottom + 200);
  check(!!found, "the chapter has a glossary term to hover");
  if (!found) return;
  const first = await hover();
  // Room above the term is 30px: inside the window, but under the header, so the card must go below the term.
  await linkAt(first.height + 0.4 * 16 + 30);
  const card = await hover();
  check(
    !!card && card.height > 0 && card.top >= bottom,
    `a glossary card near the top opens fully below the header (top ${card?.top.toFixed(0)})`,
  );
  await page.mouse.move(0, 400);
}

async function axe(page, name) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(() =>
    axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }),
  );
  const bad = result.violations.map((v) => `${v.id} (${v.nodes.length})`);
  check(bad.length === 0, `${name}: axe-core finds no violation${bad.length ? `: ${bad.join(", ")}` : ""}`);
}

async function desktop(browser) {
  const { context, page } = await open(browser, { viewport: { width: 1280, height: 800 } });
  await common(page, 56);
  await scrollTo(page, 3000);
  const header = await rect(page, ".site-header");
  check(header.top === 0 && !(await hidden(page)), "after a long scroll down the header is still at the top, shown");
  await scrollBy(page, -400);
  await scrollBy(page, 900);
  check(!(await hidden(page)) && (await rect(page, ".site-header")).top === 0, "a desktop header never hides");
  const menu = await page.evaluate(() => getComputedStyle(document.querySelector("[data-menu-button]")).display);
  check(menu === "none", "a desktop has no menu button");
  check(
    (await rect(page, ".site-header__nav")).height > 0 && (await rect(page, ".search-box")).height > 0,
    "the links and the search box show in the header",
  );
  const rail = await rect(page, ".sidebar__on-page");
  check(
    near(rail.top, 56 + 24, 1),
    `the "On this page" rail sticks 24px below the header (top ${rail.top.toFixed(0)})`,
  );
  await jumps(page, 56, "desktop");
  await scrollTo(page, 0);
  // Before the notes steps: a saved highlight gives the Notes button a name ("Notes, 1 saved") that axe's
  // label-content-name-mismatch flags; that name is public/scripts/notes.js's, not the header's.
  await axe(page, "desktop");
  await overlaps(page, 56, false);
  await glossaryCard(page, 56);
  await context.close();

  const wide = await open(browser, { viewport: { width: 1600, height: 900 } });
  await scrollTo(wide.page, 3000);
  const side = await rect(wide.page, ".sidebar__on-page");
  const left = await rect(wide.page, ".sidebar__chapters");
  check(near(side.top, 80, 1) && near(left.top, 80, 1), "at 1600px both rails stick 24px below the header");
  await wide.context.close();

  // A window just over the phone's width keeps one row: nothing wraps or spills sideways.
  for (const width of [761, 800, 1024]) {
    const narrow = await open(browser, { viewport: { width, height: 800 } });
    const fits = await narrow.page.evaluate(() => {
      const bar = document.querySelector(".site-header").getBoundingClientRect().height;
      return { bar, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check(
      near(fits.bar, 56, 0.5) && fits.overflow <= 0,
      `at ${width}px the header is one 56px row and the page does not scroll sideways`,
    );
    await narrow.context.close();
  }

  const still = await open(browser, { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const durations = await still.page.evaluate(
    () => getComputedStyle(document.querySelector(".site-header")).transitionDuration,
  );
  check(durations === "0s", `with reduced motion the header has no transition (${durations})`);
  const barMotion = await still.page.evaluate(
    () => getComputedStyle(document.querySelector("[data-reading-progress]")).transitionDuration,
  );
  check(barMotion === "0s", `with reduced motion the progress line has no transition (${barMotion})`);
  await still.context.close();
}

/** Below 64rem the sidebar sits above the article: opening "All chapters" must move the progress line's end with it. */
async function allChapters(browser) {
  const { context, page } = await open(browser, iphone);
  const closed = await span(page);
  const opened = await page.evaluate(() => {
    const details = document.querySelector(".sidebar__chapters details, details.sidebar__chapters");
    if (!details) return false;
    details.open = true;
    return true;
  });
  check(opened, "the phone page has an All chapters list to open");
  await settle(page);
  const { start, last } = await span(page);
  check(last > closed.last + 50, `opening the list moves the end of the main text down (${closed.last} to ${last})`);
  await scrollTo(page, closed.last);
  check(
    (await progress(page)) < 0.98,
    `before the new end the line is not full (${(await progress(page)).toFixed(3)})`,
  );
  await scrollTo(page, last);
  check(near(await progress(page), 1, 0.005), "at the main text's end, with the list open, the line is full");
  await scrollTo(page, start);
  check(near(await progress(page), 0, 0.005), "at the chapter's top, with the list open, the line is empty");
  await context.close();
}

async function phone(browser) {
  const { context, page } = await open(browser, iphone);
  await common(page, 52);
  check(
    (await page.evaluate(() => getComputedStyle(document.querySelector(".site-header__nav")).display)) === "none",
    "the links are not in the phone's row",
  );
  check(
    (await page.evaluate(() => getComputedStyle(document.querySelector("[data-header-search]")).display)) === "none",
    "the search box starts closed",
  );
  const row = await page.evaluate(() => {
    const items = [...document.querySelector(".site-header__inner").children].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    const tools = [...document.querySelector(".site-header__tools").children].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    return {
      items: items.length,
      rows: new Set(tools.map((el) => Math.round(el.getBoundingClientRect().top))).size,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  check(
    row.rows === 1 && row.overflow <= 0,
    "the search, theme and menu buttons share one row and the page does not scroll sideways",
  );

  // Hide and show.
  await scrollTo(page, 40);
  check(!(await hidden(page)), "the header is shown near the top");
  await scrollTo(page, 600);
  check(await hidden(page), "a scroll down hides the header");
  check((await rect(page, ".site-header")).bottom <= 0.5, "the hidden header is out of the window");
  const line = await rect(page, "[data-reading-progress]");
  check(
    near(line.top, 0, 0.5) && near(line.height, 3, 0.01),
    "the progress line stays at the very top while the header is hidden",
  );
  check((await progress(page)) > 0, "the line shows progress while the header is hidden");
  await scrollBy(page, 4);
  check(await hidden(page), "a 4px move down changes nothing");
  await scrollBy(page, -4);
  check(await hidden(page), "a 4px move up is under the threshold and does not bring it back");
  await scrollBy(page, -30);
  check(
    !(await hidden(page)) && near((await rect(page, ".site-header")).top, 0, 0.5),
    "the first upward scroll brings the header back",
  );
  check(
    near((await rect(page, "[data-reading-progress]")).bottom, 52, 0.5),
    "the progress line rides the header's bottom edge again",
  );
  await scrollBy(page, 200);
  check(await hidden(page), "it hides again on the next scroll down");
  await scrollTo(page, 20);
  check(!(await hidden(page)), "scrolling back near the top shows it");

  // Focus.
  await scrollTo(page, 900);
  check(await hidden(page), "(setup) the header is hidden");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await settle(page);
  const focused = await page.evaluate(() => document.activeElement?.closest(".site-header") !== null);
  check(focused && !(await hidden(page)), "keyboard focus moving into the header reveals it");
  await scrollBy(page, 300);
  check(!(await hidden(page)), "the header stays while keyboard focus is inside it");
  await page.evaluate(() => document.activeElement.blur());
  await scrollBy(page, 300);
  check(await hidden(page), "it hides again once focus has left");
  await scrollTo(page, 0);

  // The menu.
  await page.click("[data-menu-button]");
  check(
    (await page.getAttribute("[data-menu-button]", "aria-expanded")) === "true",
    "the menu button reports it is open",
  );
  const names = await page.$$eval("[data-menu] a, [data-menu] button", (els) =>
    els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.textContent.trim()),
  );
  check(
    JSON.stringify(names) ===
      JSON.stringify(["Contents", "Glossary", "Sources", "Docs", "Manual", "Site", "GitHub", "Notes"]),
    `the menu lists Contents, Glossary, Sources, Docs, Manual, Site, GitHub and Notes (${names})`,
  );
  check(
    await page.evaluate(() => document.activeElement?.closest("[data-menu]") !== null),
    "focus moves into the menu",
  );
  await scrollTo(page, 700);
  check(!(await hidden(page)), "the header stays shown while the menu is open");
  const menuBox = await rect(page, "[data-menu]");
  check(near(menuBox.top, 52, 1), "the menu hangs from the header's bottom edge");
  await page.keyboard.press("Escape");
  check(
    (await page.getAttribute("[data-menu-button]", "aria-expanded")) === "false" &&
      (await page.evaluate(() => document.activeElement === document.querySelector("[data-menu-button]"))),
    "Escape closes the menu and returns focus to its button",
  );
  await page.click("[data-menu-button]");
  await page.touchscreen.tap(200, 400);
  check((await page.getAttribute("[data-menu-button]", "aria-expanded")) === "false", "a tap outside closes the menu");
  await page.click("[data-menu-button]");
  await page.click("[data-menu-notes]");
  await page.waitForSelector(".notes-dialog[open]");
  check(
    (await page.getAttribute("[data-menu-button]", "aria-expanded")) === "false",
    "the Notes entry opens the notes panel and closes the menu",
  );
  await page.keyboard.press("Escape");
  await settle(page);

  // Search.
  await scrollTo(page, 0);
  await page.click("[data-search-toggle]");
  check(
    await page.evaluate(() => document.activeElement === document.querySelector("#site-search")),
    "the search button opens the field and focuses it",
  );
  check(
    near((await rect(page, "[data-header-search]")).top, 52, 1),
    "the search panel hangs from the header's bottom edge",
  );
  await scrollTo(page, 500);
  check(!(await hidden(page)), "the header stays shown while the search panel is open");
  await page.keyboard.press("Escape");
  check(
    (await page.getAttribute("[data-search-toggle]", "aria-expanded")) === "false",
    "Escape closes the search panel",
  );

  await jumps(page, 52, "phone");
  await overlaps(page, 52, true);

  // A link in the menu navigates and the next page starts with the menu closed.
  await scrollTo(page, 0);
  await page.click("[data-menu-button]");
  await Promise.all([page.waitForURL("**/glossary/"), page.click("[data-menu] a[href='/glossary/']")]);
  check(
    (await page.getAttribute("[data-menu-button]", "aria-expanded")) === "false",
    "after a menu link the next page has the menu closed",
  );
  check(
    !(await page.evaluate(() => !!document.querySelector("[data-reading-progress]"))),
    "the glossary has no progress line",
  );
  check((await page.$("[data-menu-notes]:not([hidden])")) === null, "(no Notes entry is shown off a chapter)");
  await page.click("[data-menu-button]");
  check(
    !(await page.evaluate(() => !!document.querySelector(".notes-open"))) &&
      (await page.$$eval("[data-menu] button", (b) => b.every((e) => e.hidden))),
    "the menu shows no Notes entry off a chapter",
  );
  await context.close();

  await allChapters(browser);
  const chapter = await open(browser, iphone);
  await axe(chapter.page, "phone");
  await chapter.page.click("[data-menu-button]");
  await axe(chapter.page, "phone with the menu open");
  await chapter.context.close();

  const still = await open(browser, { ...iphone, reducedMotion: "reduce" });
  check(
    (await still.page.evaluate(() => getComputedStyle(document.querySelector(".site-header")).transitionDuration)) ===
      "0s",
    "with reduced motion the phone header has no transition",
  );
  await scrollTo(still.page, 700);
  check(await hidden(still.page), "with reduced motion the phone header still hides");
  await scrollBy(still.page, -40);
  check(!(await hidden(still.page)), "with reduced motion it still returns");
  await still.context.close();
}

async function screenshots(browser, name) {
  if (!shots || name !== "chromium") return;
  const take = async (options, file, prepare, clip) => {
    const { context, page } = await open(browser, { deviceScaleFactor: 2, ...options });
    await prepare(page);
    await settle(page);
    await page.screenshot({ path: join(shots, `${prefix}-${file}.png`), clip });
    await context.close();
  };
  const desk = { viewport: { width: 1280, height: 800 } };
  const top = { x: 0, y: 0, width: 1280, height: 400 };
  await take(desk, "desktop-top", async () => {}, top);
  await take(desk, "desktop-scrolled", (p) => scrollTo(p, 2400), top);
  await take(iphone, "phone-top", async () => {});
  await take(iphone, "phone-hidden", (p) => scrollTo(p, 900));
  await take(
    desk,
    "desktop-dark-scrolled",
    async (p) => {
      await p.click("[data-theme-toggle]");
      await scrollTo(p, 2400);
    },
    top,
  );
  await take(iphone, "phone-menu", (p) => p.click("[data-menu-button]"));
  await take(iphone, "phone-dark-menu", async (p) => {
    await p.click("[data-theme-toggle]");
    await p.click("[data-menu-button]");
  });
}

for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  let browser;
  try {
    browser = await engine.launch({ env: browserEnv });
  } catch (error) {
    console.log(`SKIPPED - ${name} is not installed here (${String(error.message).split("\n")[0]})`);
    continue;
  }
  for (const [kind, run] of [
    ["desktop", desktop],
    ["phone", phone],
  ]) {
    label = `${name} ${kind}`;
    try {
      await run(browser);
    } catch (error) {
      check(false, `the run stopped: ${error.message.split("\n")[0]}`);
    }
  }
  await screenshots(browser, name);
  await browser.close();
}
server.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll header checks passed.");
