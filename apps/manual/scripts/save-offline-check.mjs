// Drives the footer's "Save the manual for offline reading" control (public/scripts/save-offline.js, ADR 0059) in a
// real Chromium against a test build of the whole book, served with public/_headers' rules and the content security
// policy. It:
//
// 1. checks that a page the worker does not control yet says to reload, and that after the reload the control shows
//    the build's size;
// 2. saves the book from the keyboard and checks that the progress bar reaches 100% and the control then shows the
//    saved date and the build, with focus on Remove;
// 3. goes offline and opens a random chapter, the glossary and a search never run before, each showing the control's
//    offline state with the saved date and build;
// 4. comes back online, removes the copy, and checks offline that an unsaved chapter then shows the offline page;
// 5. makes the worker's Cache.put refuse the space after a few files, as a full disk would, and checks that the
//    control shows a partial save with the reason and Try again, never Saved;
// 6. on an iPhone 14 touch context 390 pixels wide, checks that every button is a target of at least 44 pixels, that
//    the control has no text field, that nothing scrolls sideways, and that it saves;
// 7. checks that in forced colours the bar keeps a fill, that a host the build does not list (localhost) says offline
//    reading is off, and that no page broke the content security policy.
//
// It needs Playwright and a Chromium (the cloud sessions have both pre-installed), so it is not part of `pnpm test`.
//
//   node scripts/save-offline-check.mjs   (or: pnpm --filter @buildanagent/manual check:save-offline)
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSize } from "../public/scripts/save-offline.js";
import { loadPlaywright } from "./lib/browser-check.mjs";
import { buildTestBook, offlineEnv, serveBook } from "./lib/offline-site.mjs";

const env = offlineEnv();
const { chromium, devices } = loadPlaywright();
const work = mkdtempSync(join(tmpdir(), "manual-save-check-"));
const { dist, manifest } = await buildTestBook(work, env);
console.log(`built ${manifest.files.length} files, build ${manifest.build}`);
const server = await serveBook(() => dist);
const { origin } = server;

const results = [];
const check = (condition, message) => {
  assert.ok(condition, message);
  results.push(message);
  console.log(`ok - ${message}`);
};

const shell = new Set(manifest.shell);
// Chapters are the pages outside the shell, the offline page and the glossary.
const chapters = manifest.files
  .map((file) => file.url)
  .filter((url) => url.endsWith("/") && !shell.has(url) && !["/glossary/", "/offline/", "/gallery/"].includes(url));
const pick = () => chapters[Math.floor(Math.random() * chapters.length)];

const control = "[data-save-offline]";
const primary = "[data-save-offline-primary]";
const remove = "[data-save-offline-remove]";
const stateOf = (page) => page.locator(control).getAttribute("data-state");
const textOf = (page, part) => page.locator(`[data-save-offline-${part}]`).textContent();
const waitForState = (page, state, timeout = 30_000) =>
  page.waitForSelector(`${control}[data-state="${state}"]`, { timeout });

/** Opens the book and reloads it once the worker is active, so the worker controls the page. */
async function controlled(page, path = "/") {
  await page.goto(`${origin}${path}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

/** Records every value the progress bar takes, from inside the page. */
const watchProgress = (page) =>
  page.evaluate(() => {
    window.__progress = [];
    const bar = document.querySelector("[data-save-offline-progress]");
    new MutationObserver(() => window.__progress.push(Number(bar.getAttribute("aria-valuenow")))).observe(bar, {
      attributes: true,
      attributeFilter: ["aria-valuenow"],
    });
  });

const violations = [];
const watchPolicy = (page) =>
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

const browser = await chromium.launch({ env });
try {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  watchPolicy(page);

  // 1. The first visit, before the worker controls the page, and the reload after it.
  await page.goto(`${origin}/`);
  await page.waitForSelector(`${control}:not([hidden])`);
  check(
    (await textOf(page, "state")) === "Reload the page to save the manual for offline reading.",
    "a page the worker does not control yet says to reload, and offers no Save",
  );
  await controlled(page);
  await waitForState(page, "not-saved");
  // The control's own rounding: one decimal below 10, as in "about 5.1 MB".
  const size = formatSize(manifest.total.bytes);
  const detail = await textOf(page, "detail");
  check(
    detail.startsWith(`The whole manual is ${size}.`) && /room for about/.test(detail),
    `the control shows the build's size and the room left ("${detail}")`,
  );

  // 2. Save from the keyboard.
  await watchProgress(page);
  await page.focus(primary);
  await page.keyboard.press("Enter");
  await waitForState(page, "saved", 60_000);
  const progress = await page.evaluate(() => window.__progress);
  check(
    progress.length > 0 && Math.max(...progress) === 100,
    `the progress bar reached 100% (${progress.length} steps)`,
  );
  const saved = await textOf(page, "state");
  check(
    /^Saved on \d{1,2} \w+ \d{4}, version [0-9a-f]{8}\.$/.test(saved) &&
      saved.includes(`version ${manifest.build.slice(0, 8)}`),
    `the control shows the saved date and build ("${saved}")`,
  );
  check(
    await page.evaluate((selector) => document.activeElement === document.querySelector(selector), remove),
    "focus moved to Remove, because the pressed button went away",
  );
  check(
    (await page.locator("[data-save-offline-announce]").textContent()) === saved,
    "the live region announced the result once",
  );

  // 3. Offline: a random chapter, the glossary and a search never run online.
  await context.setOffline(true);
  await server.stop();
  const chapter = pick();
  for (const path of [chapter, "/glossary/"]) {
    await page.goto(`${origin}${path}`);
    check(
      (await page.locator("h1").count()) > 0 && !(await page.title()).includes("offline"),
      `offline, ${path} opens`,
    );
    await waitForState(page, "offline-saved");
    check(
      (await textOf(page, "state")) === "You are offline. The saved pages are available." &&
        (await textOf(page, "detail")) === saved,
      `offline, ${path} shows the offline state with the saved date and build`,
    );
  }
  const query = "approval";
  await page.goto(`${origin}/search/?q=${query}`);
  await page.waitForSelector("pagefind-results a", { timeout: 15_000 });
  check(
    (await page.locator("pagefind-results a").count()) > 0,
    `offline, a search for "${query}", never run before, finds results`,
  );

  // 4. Online again: remove the copy, then an unsaved chapter offline shows the offline page.
  await server.start();
  await context.setOffline(false);
  await page.goto(`${origin}/`);
  await waitForState(page, "saved");
  await page.click(remove);
  await page.waitForFunction(
    () => document.querySelector("[data-save-offline-state]")?.textContent === "Removed the saved copy.",
  );
  check(
    (await stateOf(page)) === "not-saved" && !(await page.locator(primary).isHidden()),
    "Remove clears the copy and offers Save again",
  );
  const left = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    return (await cache.keys()).map((request) => new URL(request.url).pathname).filter((p) => !p.includes("__manual"));
  });
  check(
    left.every((path) => shell.has(path)) && left.length === shell.size,
    `the cache keeps only the shell (${left.length} files)`,
  );
  await context.setOffline(true);
  await server.stop();
  const unsaved = chapters.find((path) => path !== chapter) ?? chapter;
  await page.goto(`${origin}${unsaved}`);
  check(
    (await page.locator("h1").textContent())?.includes("offline") === true,
    `offline, the unsaved chapter ${unsaved} shows the offline page`,
  );
  await waitForState(page, "offline-unsaved");
  check(
    (await textOf(page, "state")).startsWith("You are offline. The manual is not saved"),
    "the offline page's control says the manual is not saved",
  );

  // 5. A refused quota: the worker's Cache.put throws after a few files.
  await server.start();
  await context.setOffline(false);
  await page.goto(`${origin}/`);
  await waitForState(page, "not-saved");
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => {
    const put = Cache.prototype.put;
    let files = 0;
    Cache.prototype.put = function (key, response) {
      const url = typeof key === "string" ? key : key.url;
      if (!url.includes("__manual-offline__") && ++files > 5) {
        return Promise.reject(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
      }
      return put.call(this, key, response);
    };
  });
  await page.click(primary);
  await waitForState(page, "partial", 60_000);
  check(
    /^Partly saved: \d+ of \d+ files\.$/.test(await textOf(page, "state")) &&
      (await textOf(page, "detail")).startsWith("The browser ran out of room for the manual.") &&
      (await page.locator(primary).textContent()) === "Try again",
    `a refused quota shows a partial save with the reason and Try again ("${await textOf(page, "state")}")`,
  );
  await context.close();

  // 6. A phone: 44 pixel targets, no text field, no sideways scroll.
  const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 14"];
  const touch = await browser.newContext({ ...phone, serviceWorkers: "allow" });
  const mobile = await touch.newPage();
  watchPolicy(mobile);
  await controlled(mobile, "/tools/");
  await waitForState(mobile, "not-saved");
  check(phone.viewport.width === 390, `the phone context is ${phone.viewport.width} pixels wide`);
  const measure = () =>
    mobile.evaluate(() => ({
      buttons: [...document.querySelectorAll("[data-save-offline] button")]
        .filter((button) => !button.hidden)
        .map((button) => {
          const box = button.getBoundingClientRect();
          return { text: button.textContent.trim(), width: box.width, height: box.height };
        }),
      fields: document.querySelectorAll("[data-save-offline] :is(input, textarea, select, [contenteditable])").length,
      sideways: document.scrollingElement.scrollWidth > window.innerWidth,
    }));
  const before = await measure();
  await mobile.locator(primary).scrollIntoViewIfNeeded();
  await mobile.locator(primary).tap();
  await waitForState(mobile, "saved", 60_000);
  const after = await measure();
  const buttons = [...before.buttons, ...after.buttons];
  check(
    buttons.length >= 2 && buttons.every((button) => button.width >= 44 && button.height >= 44),
    `every button is at least 44 pixels (${buttons.map((b) => `${b.text}: ${Math.round(b.width)}x${Math.round(b.height)}`).join("; ")})`,
  );
  check(
    before.fields === 0 && after.fields === 0,
    "the control has no text field, so the 16px field rule has nothing to apply to",
  );
  check(!before.sideways && !after.sideways, "nothing scrolls sideways at 390 pixels, with the note sheet closed");
  check(
    (await mobile.locator(".notes-pop[data-sheet]:not([hidden])").count()) === 0,
    "the note sheet stayed closed throughout",
  );

  // 7. Forced colours, a host the build does not list, and the policy.
  await mobile.click(remove);
  await waitForState(mobile, "not-saved");
  await mobile.emulateMedia({ forcedColors: "active" });
  await mobile.evaluate(() => {
    document.querySelector("[data-save-offline-progress]").hidden = false;
    document.querySelector("[data-save-offline-bar]").style.inlineSize = "50%";
  });
  const fill = await mobile.evaluate(
    () => getComputedStyle(document.querySelector("[data-save-offline-bar]")).backgroundColor,
  );
  check(!/rgba\(0, 0, 0, 0\)|transparent/.test(fill), `in forced colours the bar keeps a fill (${fill})`);
  await touch.close();

  const other = await browser.newContext({ serviceWorkers: "allow" });
  const otherPage = await other.newPage();
  await otherPage.goto(`http://localhost:${server.port}/`);
  await otherPage.waitForSelector(`${control}[data-state="unavailable"]`);
  check(
    (await textOf(otherPage, "state")) === "Offline reading is turned off on this copy of the manual." &&
      (await otherPage.locator(`${control} button:not([hidden])`).count()) === 0,
    "a host the build does not list (localhost) says offline reading is off and offers no button",
  );
  await other.close();
  check(violations.length === 0, `no content security policy violations (${violations.join(" | ") || "none"})`);
  console.log(`\n${results.length} checks passed`);
} finally {
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
  rmSync(env.HOME, { recursive: true, force: true });
}
