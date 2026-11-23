// Drives the offline service worker (ADR 0059) in a real Chromium against a test build of the whole book. It builds
// the book into a temporary folder with MANUAL_OFFLINE_TEST_HOST=127.0.0.1, the only way a build lets a loopback host
// register the worker, and serves it with a static server that sends public/_headers' rules, the content security
// policy included. Like Cloudflare's Email Address Obfuscation, the server rewrites every address on a page into a
// protected link and adds the decoding script, so the pages that hold an address differ from the build's bytes.
// Then it:
//
// 1. lands on a chapter, waits for the worker to save the shell and that first page, and asks Chromium whether the
//    app is installable;
// 2. reads a chapter whose addresses the server rewrote, which the worker saves and reports as rewritten;
// 3. goes offline (context.setOffline(true), and the server stops) and opens the contents, the landing chapter, the
//    rewritten chapter after a reload, a deep link, a page without its slash and an unsaved page, which shows the
//    offline page; runs two searches never run online; and saves a highlight that is still there after a reload;
// 4. comes back online with a changed build, and checks that the update notice shows and only Reload reloads;
// 5. checks that a host the build does not list (localhost) registers no worker.
//
// It needs Playwright and a Chromium (the cloud sessions have both pre-installed), so it is not part of `pnpm test`.
//
//   node scripts/offline-browser-check.mjs
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlaywright } from "./lib/browser-check.mjs";
import { buildTestBook, offlineEnv, serveBook } from "./lib/offline-site.mjs";
import { writeOffline } from "./offline-build.mjs";

const env = offlineEnv();
const { chromium } = loadPlaywright();

// 0. A test build: the production build's steps, with the loopback test host.
const work = mkdtempSync(join(tmpdir(), "manual-offline-check-"));
const { dist, manifest: first } = await buildTestBook(work, env);
console.log(`built ${first.files.length} files, build ${first.build}`);

let root = dist;

// What Cloudflare's Email Address Obfuscation does to a page: each address becomes a protected link, and the page
// gains the decoding script.
const ADDRESS = /(?<![\w.@-])[\w.+-]+@example\.(?:com|net)\b/g;
function rewriteLikeCloudflare(html) {
  if (!ADDRESS.test(html)) return html;
  return html
    .replace(ADDRESS, '<a href="/cdn-cgi/l/email-protection" class="__cf_email__">[email&#160;protected]</a>')
    .replace("</body>", '<script data-cfasync="false" src="/cdn-cgi/scripts/email-decode.min.js"></script></body>');
}
const {
  origin,
  port,
  stop: stopServer,
  start: startServer,
  close: closeServer,
} = await serveBook(() => root, rewriteLikeCloudflare);

const results = [];
const check = (condition, message) => {
  assert.ok(condition, message);
  results.push(message);
  console.log(`ok - ${message}`);
};

const browser = await chromium.launch({ env });
try {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const violations = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  const ask = (message) =>
    page.evaluate(
      (data) =>
        new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => resolve(event.data);
          navigator.serviceWorker.ready.then((registration) => registration.active.postMessage(data, [channel.port2]));
        }),
      message,
    );

  // 1. The first visit lands on a chapter: the worker installs, saves the shell, then saves the chapter it was not
  // controlling when the page loaded.
  const LANDING = "/call-workflow-loop/";
  await page.goto(`${origin}${LANDING}`);
  const state = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
  check(state === "activated" || state === "activating", `the worker installs on the test host (${state})`);
  check(
    !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))),
    "the landing page loaded before the worker, so the worker does not control it",
  );
  await page.waitForFunction(async (path) => Boolean(await caches.match(path)), LANDING, { timeout: 15_000 });
  const status = await ask({ type: "STATUS" });
  check(
    status.build === first.build &&
      status.shell.saved === status.shell.files &&
      status.shell.files === first.shell.length,
    `STATUS reports build ${status.build} with all ${status.shell.files} shell files saved, Pagefind's included`,
  );
  check(true, "SAVE_PAGE saved the landing chapter the worker did not control");
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors: errors } = await cdp.send("Page.getInstallabilityErrors");
  check(
    errors.length === 0,
    `Chromium finds no installability errors (${errors.map((e) => e.errorId).join(", ") || "none"})`,
  );
  const { url: manifestUrl, errors: manifestErrors } = await cdp.send("Page.getAppManifest");
  check(
    manifestUrl === `${origin}/manifest.webmanifest` && manifestErrors.length === 0,
    "the page links the manifest and Chromium parses it without errors",
  );

  // 2. A chapter whose addresses the server rewrote is saved and reported, not dropped in silence.
  await page.goto(`${origin}/tools/`);
  await page.waitForSelector(".notes-open");
  check(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    "the next page is controlled by the worker",
  );
  const heading = await page.evaluate(() => document.querySelector("article h2[id]")?.id);
  check(
    await page.evaluate(() => document.body.innerHTML.includes("[email")),
    "the server rewrote the chapter's addresses",
  );
  await page.waitForFunction(async () => Boolean(await caches.match("/tools/")), undefined, { timeout: 15_000 });
  const afterTools = await ask({ type: "STATUS" });
  check(
    afterTools.rewritten.includes("/tools/") && afterTools.failed.length === 0,
    `STATUS reports the rewritten chapter (${afterTools.rewritten.join(", ")}) and no failures`,
  );

  // 3. Offline.
  await context.setOffline(true);
  await stopServer();
  await page.goto(`${origin}/`);
  check((await page.locator(".contents__chapter").count()) > 0, "offline, the contents page opens");
  await page.goto(`${origin}${LANDING}`);
  check(
    (await page.locator("article[data-reading-chapter='call-workflow-loop']").count()) === 1,
    "offline, the chapter the reader landed on first opens",
  );
  await page.goto(`${origin}/tools/`);
  await page.reload();
  check(
    (await page.locator("article[data-reading-chapter='tools']").count()) === 1,
    "offline, the rewritten chapter opens and survives a reload",
  );
  check(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes("Literata")),
    "offline, the chapter has the book's stylesheet",
  );
  await page.goto(`${origin}/tools/?from=offline#${heading}`);
  check(
    (await page.locator(`[id="${heading}"]`).count()) === 1,
    "offline, a deep link with a query string and a fragment opens the saved chapter",
  );
  await page.goto(`${origin}/tools?from=offline`);
  check(new URL(page.url()).pathname === "/tools/", "offline, a page asked for without its slash redirects to it");
  await page.goto(`${origin}/glossary/`);
  check(
    (await page.locator("h1").textContent())?.includes("offline") === true,
    "offline, a page that was never opened shows the offline page",
  );
  for (const query of ["sandbox", "gateway"]) {
    await page.goto(`${origin}/search/?q=${query}`);
    await page.waitForSelector("pagefind-results a", { timeout: 15_000 });
    const hits = await page.locator("pagefind-results a").count();
    check(hits > 0, `offline, a search for "${query}", never run online, finds ${hits} links from the shell`);
  }

  await page.goto(`${origin}/tools/`);
  await page.waitForSelector(".notes-open");
  await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll("article p")].find((p) => p.textContent.trim().length > 200);
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (node.data.length < 40 || node.parentElement.closest("a, code, [aria-hidden='true']"))) {
      node = walker.nextNode();
    }
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 30);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar .notes-swatch--green");
  await page.reload();
  await page.waitForSelector(".notes-open");
  check(
    await page.evaluate(() => CSS.highlights.get("manual-hl-green")?.size === 1),
    "offline, a highlight saved offline is still there after a reload",
  );
  check(violations.length === 0, `no content security policy violations (${violations.join(" | ") || "none"})`);

  // 4. A new deploy: the same book with a changed offline page, so its worker's bytes differ.
  const next = join(work, "next");
  cpSync(dist, next, { recursive: true });
  const offlinePage = join(next, "offline", "index.html");
  writeFileSync(offlinePage, readFileSync(offlinePage, "utf8").replace("</p>", " (Changed.)</p>"));
  const second = await writeOffline(next);
  root = next;
  await startServer();
  await context.setOffline(false);
  await page.goto(`${origin}/`);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
  await page.waitForSelector(".update-notice", { timeout: 15_000 });
  check(true, `a new deploy (build ${second.build}) shows the update notice`);
  const marker = await page.evaluate(() => {
    window.__notReloaded = true;
    return true;
  });
  await page.waitForTimeout(1000);
  check(
    marker && (await page.evaluate(() => window.__notReloaded === true)),
    "the page does not reload while the notice waits",
  );
  await Promise.all([
    page.waitForEvent("load"),
    page.click(".update-notice__button:not(.update-notice__button--quiet)"),
  ]);
  const after = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(event.data);
        navigator.serviceWorker.controller.postMessage({ type: "STATUS" }, [channel.port2]);
      }),
  );
  check(after.build === second.build, `Reload reloads the page under the new build's worker (${after.build})`);
  const cacheNames = await page.evaluate(() => caches.keys());
  check(
    cacheNames.length === 1 && cacheNames[0] === `manual-${second.build}`,
    `the old build's cache is gone once its last page reloaded (${cacheNames.join(", ")})`,
  );
  const carried = await page.evaluate(
    async ([name, path]) => {
      const response = await (await caches.open(name)).match(path);
      return response ? (await response.text()).includes(`content="${name.slice("manual-".length)}"`) : false;
    },
    [`manual-${second.build}`, LANDING],
  );
  check(carried, "the landing chapter saved under the old build carried over, stamped with the new build");
  await context.close();

  // 5. A host the build does not list registers nothing.
  const other = await browser.newContext({ serviceWorkers: "allow" });
  const otherPage = await other.newPage();
  await otherPage.goto(`http://localhost:${port}/`);
  await otherPage.waitForTimeout(1000);
  check(
    (await otherPage.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)) === 0,
    "a host the build does not list (localhost) registers no worker",
  );
  await other.close();
  console.log(`\n${results.length} checks passed`);
} finally {
  await browser.close();
  closeServer();
  rmSync(work, { recursive: true, force: true });
  rmSync(env.HOME, { recursive: true, force: true });
}
