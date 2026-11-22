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

/** Reads the open popover's layout: its order, sizes and colours, for the checks below. */
function readPopover(page) {
  return page.evaluate(() => {
    const pop = document.querySelector(".notes-pop");
    const box = (selector) => {
      const el = pop.querySelector(selector);
      if (!el || el.hidden || el.getClientRects().length === 0) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        height: r.height,
        width: r.width,
        fontSize: style.fontSize,
        fontStyle: style.fontStyle,
        color: style.color,
        borderLeft: style.borderLeftWidth,
        borderLeftColor: style.borderLeftColor,
        borderTop: style.borderTopWidth,
        lineHeight: parseFloat(style.lineHeight),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        title: el.getAttribute("title"),
      };
    };
    const probe = document.createElement("span");
    probe.style.color = "var(--color-danger)";
    document.body.append(probe);
    const danger = getComputedStyle(probe).color;
    probe.style.color = "var(--color-highlight-edge-blue)";
    const edgeBlue = getComputedStyle(probe).color;
    probe.remove();
    const pr = pop.getBoundingClientRect();
    return {
      sheet: pop.hasAttribute("data-sheet"),
      rect: { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom, width: pr.width },
      viewport: { w: document.documentElement.clientWidth, h: innerHeight },
      colors: box(".notes-colors"),
      swatch: box(".notes-swatch"),
      quote: box(".notes-pop__quote"),
      note: box(".notes-pop__note"),
      field: box(".notes-pop__field"),
      actions: box(".notes-pop__actions"),
      save: box("[data-action='save']"),
      remove: box("[data-action='delete']"),
      removeColor: danger,
      edgeBlue,
      grab: box(".notes-pop__grab"),
      focusReturn: null,
    };
  });
}

/** Checks the popover's order, type, bar, actions and its desktop or sheet geometry. */
async function checkPopoverLayout(page, name, mobile, plain, label) {
  const p = await readPopover(page);
  check(p.colors && p.quote && p.actions, `${name}: ${label} shows the colours, the quotation and the actions`);
  check(p.colors.top < p.quote.top, `${name}: ${label} puts the colours above the quotation`);
  if (plain) {
    check(p.field && p.save && !p.note, `${name}: ${label} shows an Add-a-note field with Save and no note`);
    check(
      p.quote.bottom <= p.field.top && p.field.bottom <= p.actions.top,
      `${name}: ${label} is quotation, field, actions`,
    );
  } else {
    check(p.note && !p.field, `${name}: ${label} shows the note as text`);
    check(
      p.quote.bottom <= p.note.top && p.note.bottom <= p.actions.top,
      `${name}: ${label} is quotation, note, actions`,
    );
    check(p.note.fontSize === "15.5px", `${name}: the note is at the body size (${p.note.fontSize})`);
  }
  check(
    p.quote.fontSize === "13px" && p.quote.fontStyle === "normal",
    `${name}: the quotation is 13px and upright (${p.quote.fontSize}, ${p.quote.fontStyle})`,
  );
  check(p.quote.borderLeft === "3px", `${name}: the quotation has a 3px bar (${p.quote.borderLeft})`);
  check(p.actions.borderTop === "1px", `${name}: the actions sit below a hairline`);
  check(p.removeColor === p.remove.color, `${name}: Remove has the destructive colour (${p.removeColor})`);
  if (mobile) {
    check(p.sheet, `${name}: a narrow window gets a bottom sheet`);
    check(
      Math.round(p.rect.left) === 0 &&
        Math.round(p.rect.width) === p.viewport.w &&
        Math.round(p.rect.bottom) === p.viewport.h,
      `${name}: the sheet spans the window's width at its bottom`,
    );
    check(p.grab && p.grab.height >= 20, `${name}: the sheet has a handle`);
    const touch = await page.evaluate(() =>
      [...document.querySelectorAll(".notes-pop__act, .notes-pop .notes-swatch")]
        .filter((el) => !el.hidden)
        .map((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)),
    );
    check(
      touch.every((size) => size >= 44),
      `${name}: every action and colour is a 44px target on touch (${touch.join(",")})`,
    );
  } else {
    check(!p.sheet && p.rect.width <= 331, `${name}: a wide window gets a popover up to 330px (${p.rect.width})`);
  }
  return p;
}

/** A long passage is cut to three lines (two in a sheet) with its full text as the tooltip. */
async function checkClamp(page, name, mobile) {
  const long = await selectIn(page, 0, 0, 250);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar .notes-swatch--blue");
  await page.evaluate(() => {
    const [range] = CSS.highlights.get("manual-hl-blue");
    range.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "instant" });
  });
  await page.waitForTimeout(400);
  const point = await page.evaluate(() => {
    const [range] = CSS.highlights.get("manual-hl-blue");
    // The widest line, because the first can be a few pixels at a line's end.
    const rect = [...range.getClientRects()].sort((a, b) => b.width - a.width)[0];
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  if (mobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await page.waitForSelector(".notes-pop:popover-open");
  const p = await readPopover(page);
  const lines = mobile ? 2 : 3;
  check(p.quote.scrollHeight > p.quote.clientHeight, `${name}: a long passage is cut off in the quotation`);
  check(
    p.quote.clientHeight <= p.quote.lineHeight * lines + 1,
    `${name}: the quotation is at most ${lines} lines (${p.quote.clientHeight}px of ${p.quote.lineHeight}px lines)`,
  );
  check(
    p.quote.title === long.trim() || p.quote.title.startsWith(long.trim().slice(0, 40)),
    `${name}: the full passage is the tooltip`,
  );
  check(p.quote.borderLeftColor === p.edgeBlue, `${name}: the bar takes the blue highlight's edge colour`);
  await page.keyboard.press("Escape");
}

/** A swipe down on the sheet's handle closes it; a short drag does not. */
async function checkSheetGestures(page, name) {
  const grab = await page.locator(".notes-pop__grab").boundingBox();
  const x = grab.x + grab.width / 2;
  const y = grab.y + grab.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 4 });
  await page.mouse.up();
  check(
    (await page.locator(".notes-pop:popover-open").count()) === 1,
    `${name}: a short drag on the handle leaves the sheet open`,
  );
  const again = await page.locator(".notes-pop__grab").boundingBox();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + again.width / 2, again.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  check(
    (await page.locator(".notes-pop:popover-open").count()) === 0,
    `${name}: a swipe down on the handle closes the sheet`,
  );
}

/** The margin marker: a 28px button in the gutter, level with the passage, that brightens its passage and opens the popover. */
async function checkMarker(page, name, shots) {
  await page.waitForSelector(".notes-markers .notes-marker", { state: "attached" });
  const info = await page.evaluate(() => {
    const el = document.querySelector(".notes-markers .notes-marker");
    const box = el.getBoundingClientRect();
    const article = document.querySelector("article p").getBoundingClientRect();
    return {
      w: box.width,
      h: box.height,
      left: box.left,
      right: box.right,
      articleRight: article.right,
      viewport: document.documentElement.clientWidth,
      label: el.getAttribute("aria-label"),
      tag: el.tagName,
      dots: document.querySelectorAll("article .notes-dot").length,
    };
  });
  const hovered = () => page.evaluate(() => [...CSS.highlights.keys()].some((key) => key.startsWith("manual-hover-")));
  check(info.tag === "BUTTON" && info.label === "Note 1", `${name}: the marker is a button named "Note 1"`);
  check(info.w === 28 && info.h === 28, `${name}: the marker is 28 by 28 CSS pixels (${info.w}x${info.h})`);
  check(info.left >= info.articleRight, `${name}: the marker sits in the margin, right of the text column`);
  check(
    info.right <= info.viewport,
    `${name}: the marker is not cut off at the right edge (${info.right} <= ${info.viewport})`,
  );
  check(info.dots === 0, `${name}: nothing is inserted into the article`);
  await page.evaluate(() => document.querySelector(".notes-markers .notes-marker").scrollIntoView({ block: "center" }));
  // Focus from an earlier step would keep the shade, so each source is tried alone.
  await page.evaluate(() => document.activeElement?.blur());
  await page.locator(".notes-markers .notes-marker").hover();
  check(await hovered(), `${name}: hovering the marker brightens its passage`);
  if (shots) await page.screenshot({ path: join(shots, `${name}-marker.png`) });
  await page.mouse.move(5, 5);
  check(!(await hovered()), `${name}: leaving the marker puts the passage back`);
  // A marker that already has focus raises no focus event, so focus starts from the page.
  await page.evaluate(() => document.activeElement?.blur());
  await page.focus(".notes-markers .notes-marker");
  check(await hovered(), `${name}: focusing the marker brightens its passage`);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".notes-pop:popover-open");
  check((await page.textContent(".notes-pop__quote")).length > 10, `${name}: Enter on the marker opens the popover`);
  await page.keyboard.press("Escape");
  check(!(await page.locator(".notes-pop:popover-open").count()), `${name}: Escape closes the popover`);
  await page.click(".notes-markers .notes-marker");
  await page.waitForSelector(".notes-pop:popover-open");
  check(true, `${name}: a click on the marker opens the popover`);
  await page.keyboard.press("Escape");
}

/** The inline dot: about 16px, raised, after the passage's last word, on no following character. */
async function checkDot(page, name, shots) {
  await page.waitForSelector("article .notes-dot", { state: "attached" });
  const dot = await page.evaluate(() => {
    const el = document.querySelector("article .notes-dot");
    const box = el.getBoundingClientRect();
    const article = document.querySelector("article").getBoundingClientRect();
    const style = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
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
      right: box.right,
      left: box.left,
      w: box.width,
      h: box.height,
      articleRight: article.right,
      raised: style.top,
      reach: [after.top, after.left, after.right, after.bottom],
      label: el.getAttribute("aria-label"),
      text: el.textContent,
      lastRight: last && last.right,
      firstLeft: first && first.left,
      sameLineAfter: first ? Math.abs((first.top + first.bottom) / 2 - (box.top + box.bottom) / 2) < 12 : true,
      focusable: el.tabIndex === 0,
      markers: document.querySelectorAll(".notes-markers .notes-marker").length,
    };
  });
  check(dot.label === "Note 1" && dot.text === "", `${name}: the dot is named "Note 1" and holds no text`);
  check(dot.focusable, `${name}: the dot can take keyboard focus`);
  check(dot.markers === 0, `${name}: a narrow window draws no margin marker`);
  check(dot.w >= 14 && dot.w <= 26 && dot.h >= 12 && dot.h <= 22, `${name}: the dot is about 16px (${dot.w}x${dot.h})`);
  check(parseFloat(dot.raised) < 0, `${name}: the dot is raised like a footnote mark (${dot.raised})`);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const reach = coarse ? "-14px" : "-4px";
  check(
    dot.reach.every((value) => value === reach),
    `${name}: the target reaches ${reach.slice(1)} around the dot (${coarse ? "touch" : "pointer"})`,
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
  check(
    await page.evaluate(() => !document.querySelector("article").innerText.includes("⁠1")),
    `${name}: the dot's number is not text in the article`,
  );
  await page.evaluate(() => document.querySelector("article .notes-dot").scrollIntoView({ block: "center" }));
  if (shots) await page.screenshot({ path: join(shots, `${name}-dot.png`) });
  await page.locator("article .notes-dot").click({ force: false });
  await page.waitForSelector(".notes-pop:popover-open");
  check((await page.textContent(".notes-pop__quote")).length > 10, `${name}: a click on the dot opens the popover`);
  await page.keyboard.press("Escape");
  check(!(await page.locator(".notes-pop:popover-open").count()), `${name}: Escape closes the popover`);
  await page.focus("article .notes-dot");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".notes-pop:popover-open");
  check(true, `${name}: Enter on the focused dot opens the popover`);
  await page.keyboard.press("Escape");
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
  await checkPopoverLayout(page, name, mobile, true, "a plain highlight's popover");
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

  // 6. A note gets a marker: a speech bubble in the margin where the article leaves room beside it, a numbered dot after
  // the passage where it does not. A click or Enter on it opens the popover.
  await selectIn(page, 2, 10, 70);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar >> text=Add note");
  await page.fill("#notes-field", "A private note that Share must not copy.");
  await page.click(".notes-dialog__form button[type='submit']");
  await page.click(".notes-dialog__head button");
  const gutter = () =>
    page.evaluate(
      () => document.documentElement.clientWidth - document.querySelector("article p").getBoundingClientRect().right,
    );
  const wide = (await gutter()) >= 44;
  const articleHtml = await page.evaluate(() => document.querySelector("article").innerHTML);
  if (wide) await checkMarker(page, name, shots);
  else await checkDot(page, name, shots);
  const scroll = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(
    scroll.scroll <= scroll.client,
    `${name}: the page does not scroll sideways (${scroll.scroll} <= ${scroll.client})`,
  );
  // Crossing the gutter's width swaps one for the other and leaves the article's markup as it was.
  await page.setViewportSize(wide ? { width: 393, height: 852 } : { width: 1280, height: 900 });
  await page.waitForTimeout(500);
  const nowWide = (await gutter()) >= 44;
  check(nowWide !== wide, `${name}: the other width has the other layout`);
  const counts = await page.evaluate(() => ({
    markers: document.querySelectorAll(".notes-markers .notes-marker").length,
    dots: document.querySelectorAll("article .notes-dot").length,
  }));
  check(
    nowWide ? counts.markers === 1 && counts.dots === 0 : counts.markers === 0 && counts.dots === 1,
    `${name}: after a resize the ${nowWide ? "margin marker" : "dot"} replaces the ${nowWide ? "dot" : "marker"}`,
  );
  await page.setViewportSize(wide ? { width: 1280, height: 900 } : { width: 393, height: 852 });
  await page.waitForTimeout(500);
  check(
    (await page.evaluate(() => document.querySelector("article").innerHTML)) === articleHtml,
    `${name}: back at the first width the article's markup is exactly as it was`,
  );
  await (wide ? checkMarker : checkDot)(page, name, undefined);
  await page.click(wide ? ".notes-markers .notes-marker" : "article .notes-dot");
  await page.waitForSelector(".notes-pop:popover-open");
  await checkPopoverLayout(page, name, mobile, false, "a noted highlight's popover");
  if (shots) await page.screenshot({ path: join(shots, `${name}-note-popover.png`) });
  if (mobile) {
    await checkSheetGestures(page, name);
    await page.click(wide ? ".notes-markers .notes-marker" : "article .notes-dot");
    await page.waitForSelector(".notes-pop:popover-open");
  }
  await page.click(".notes-pop button[data-action='share']");
  await page.waitForFunction(() => document.querySelector(".notes-pop__message")?.textContent.includes("Copied"));
  check(
    !(await page.evaluate(() => navigator.clipboard.readText())).includes("private note"),
    `${name}: Share leaves the note out`,
  );
  await page.keyboard.press("Escape");
  check(!(await page.locator(".notes-pop:popover-open").count()), `${name}: Escape closes the popover`);

  // 7. A long passage is cut off, and Escape gives focus back to the marker.
  await page.keyboard.press("Escape");
  await checkClamp(page, name, mobile);
  await page.focus(wide ? ".notes-markers .notes-marker" : "article .notes-dot");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".notes-pop:popover-open");
  await page.keyboard.press("Escape");
  check(
    await page.evaluate(() => Boolean(document.activeElement?.closest(".notes-marker, .notes-dot"))),
    `${name}: Escape gives focus back to the marker`,
  );

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
