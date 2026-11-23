// Checks the notes panel (the B1 design in docs/design/notes/) in real browsers against the built book: desktop
// Chromium, an iPhone 14 profile in Chromium and, when a WebKit build is installed, the same two in WebKit (the engine
// Safari uses). It checks that:
//  - the Notes button opens a panel on the window's right, below the sticky header, in a 1280x900 window, a 1280x420
//    one and on a phone, where it takes the whole width; its body scrolls inside it;
//  - the panel's header holds the title "Notes", the count ("3 in this chapter"), and Export and Close as named icon
//    buttons, followed by the hint "Click a note to go to its passage." and the footer "Saved in this browser only.",
//    whose tooltip holds the longer sentence on storage;
//  - each card shows at most two buttons: its passage and note as one button that goes to the passage, and one "More
//    actions" button; no card has the old row of text buttons or colour buttons;
//  - the menu opens from the keyboard and the mouse, the arrow keys, Home and End move through it, Escape closes it and
//    gives focus back to its button, and only one menu is open at a time;
//  - a colour in the menu recolours the highlight on the page and the card's bar at once; Delete deletes at once and
//    moves focus to the next card; Share copies a link; Export copies the Markdown; with every note deleted the panel
//    says how to add one;
//  - a card goes to its passage; Edit closes the panel and opens the note popover at the passage with the field ready,
//    or the sheet on a phone;
//  - Escape and a click outside close the panel and focus returns to the Notes button; Alt+Shift+N opens it;
//  - every action is reachable from the keyboard alone, every control is a 44px target on a touch screen, the panel's
//    roles, names and states read as they should in the accessibility tree, and axe-core finds no violation in it.
//
// It needs Playwright and a built book (`pnpm --filter @buildanagent/manual build`), so `pnpm test` does not run it.
// WebKit is optional: install it with `PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit` and run with the
// same variable; without it that part is skipped with a message. `--shots <folder>` saves screenshots of the panel on
// a desktop in the light and the dark theme, with a menu open, and on a phone.
//
//   node scripts/notes-panel-check.mjs [--shots <folder>]   (or: pnpm --filter @buildanagent/manual check:notes-panel)
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { browserEnv, loadPlaywright, selectIn, serveDist } from "./lib/browser-check.mjs";

const playwright = loadPlaywright();
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt >= 0 ? process.argv[shotsAt + 1] : undefined;
if (shots) mkdirSync(shots, { recursive: true });
const { server, origin } = await serveDist();
const failures = [];
let count = 0;
const check = (condition, message) => {
  count += 1;
  console.log(`${condition ? "ok" : "NOT OK"} - ${message}`);
  if (!condition) failures.push(message);
};

const NOTES = ["Check this against the cost cap in chapter 4.", "", "Reuse in the approvals chapter."];

/** Opens the chapter with no notes stored, then adds two notes and one plain highlight through the toolbar. */
async function seeded(page) {
  await page.goto(`${origin}/tools/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".notes-open");
  for (const [i, note] of NOTES.entries()) {
    await selectIn(page, i, 0, 40);
    await page.waitForSelector(".notes-toolbar:not([hidden])");
    if (!note) {
      await page.click(".notes-toolbar .notes-swatch--green");
      continue;
    }
    await page.click(".notes-toolbar >> text=Add note");
    await page.waitForSelector(".notes-pop:popover-open");
    await page.fill(".notes-pop__field", note);
    await page.click(".notes-pop__act[data-action='save']");
    await page.waitForSelector(".notes-pop:not(:popover-open)", { state: "attached" });
  }
}

/** The panel's geometry, its cards' shown buttons, and the header's bottom edge while it shows. */
function readPanel(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector(".notes-dialog");
    const r = dialog.getBoundingClientRect();
    const header = document.querySelector("[data-site-header]");
    const shown = (el) => el.getClientRects().length > 0 && el.closest("[hidden]") === null;
    const hidden = document.documentElement.hasAttribute("data-header-hidden");
    const cards = [...dialog.querySelectorAll(".notes-card")].map((card) => ({
      id: card.getAttribute("data-id"),
      color: card.getAttribute("data-color"),
      bar: getComputedStyle(card).borderLeftColor,
      buttons: [...card.querySelectorAll("button")]
        .filter(shown)
        .map((button) => button.getAttribute("aria-label") ?? `go:${button.textContent.trim().slice(0, 20)}`),
    }));
    const body = dialog.querySelector(".notes-panel__body");
    return {
      open: dialog.open,
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width },
      viewport: { w: document.documentElement.clientWidth, h: innerHeight },
      headerBottom: hidden || !header ? 0 : header.getBoundingClientRect().bottom,
      cards,
      allButtons: [...dialog.querySelectorAll("button")].filter(shown).length,
      count: dialog.querySelector(".notes-panel__count")?.textContent,
      hint: shown(dialog.querySelector(".notes-panel__hint"))
        ? dialog.querySelector(".notes-panel__hint").textContent
        : null,
      foot: dialog.querySelector(".notes-panel__foot span")?.textContent,
      footTitle: dialog.querySelector(".notes-panel__foot")?.getAttribute("title"),
      empty: shown(dialog.querySelector(".notes-panel__empty"))
        ? dialog.querySelector(".notes-panel__empty").textContent
        : null,
      bodyScrolls: getComputedStyle(body).overflowY === "auto",
      oldRows: dialog.querySelectorAll(".notes-dialog__item, .notes-card .notes-dialog__actions").length,
      oldText: [...dialog.querySelectorAll("button")]
        .filter(shown)
        .map((button) => button.textContent.trim())
        .filter((text) =>
          ["Go to passage", "Edit note", "Delete", "Share", "Amber", "Export as Markdown"].includes(text),
        ),
      transition: getComputedStyle(dialog).transitionDuration,
    };
  });
}

/** The edge colour a card's bar should take for each highlight colour, read from the page's tokens. */
function edgeColors(page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const out = {};
    for (const [color, token] of [
      ["amber", "--color-highlight-edge"],
      ["green", "--color-highlight-edge-green"],
      ["blue", "--color-highlight-edge-blue"],
      ["pink", "--color-highlight-edge-pink"],
    ]) {
      probe.style.color = `var(${token})`;
      out[color] = getComputedStyle(probe).color;
    }
    probe.remove();
    return out;
  });
}

const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      label: el?.getAttribute("aria-label") ?? null,
      role: el?.getAttribute("role") ?? null,
      text: el?.textContent?.trim().slice(0, 40) ?? "",
      action: el?.getAttribute("data-action") ?? null,
      card: el?.closest(".notes-card")?.getAttribute("data-id") ?? null,
      inPop: !!el?.closest(".notes-pop"),
      cls: el?.className ?? "",
    };
  });
const openMenus = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".notes-menu")].filter((menu) => !menu.hidden).length);

/** The panel sits on the window's right, from the header's bottom edge to the window's foot. */
async function checkPlace(page, name, phone) {
  const p = await readPanel(page);
  check(p.open, `${name}: the Notes button opens the panel`);
  check(
    Math.abs(p.rect.top - p.headerBottom) <= 1,
    `${name}: the panel starts at the header's bottom edge (top ${p.rect.top}, header ${p.headerBottom})`,
  );
  check(
    Math.abs(p.rect.bottom - p.viewport.h) <= 1 && Math.abs(p.rect.right - p.viewport.w) <= 1,
    `${name}: and reaches the window's foot and right edge (${JSON.stringify(p.rect)})`,
  );
  if (phone) check(Math.round(p.rect.width) === p.viewport.w, `${name}: on a phone it takes the whole width`);
  else check(Math.round(p.rect.width) === 400, `${name}: on a desktop it is 400px wide (${p.rect.width})`);
  check(p.bodyScrolls, `${name}: its body scrolls inside it`);
  return p;
}

async function desktop(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  // WebKit knows no clipboard permission; there Share and Export may fall back to a field to copy by hand.
  if (browser.browserType().name() === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  }
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) requests.push(request.url());
  });
  await seeded(page);
  const edges = await edgeColors(page);
  await page.evaluate(() => scrollTo(0, 600));
  await page.click(".notes-open");
  await page.waitForSelector(".notes-dialog[open]");
  let p = await checkPlace(page, name, false);

  // 1. What the panel shows.
  check(p.count === "3 in this chapter", `${name}: the header counts the chapter's notes (${p.count})`);
  check(p.hint === "Click a note to go to its passage.", `${name}: the hint line says what a click does`);
  check(p.foot === "Saved in this browser only.", `${name}: the footer is one line (${p.foot})`);
  check(
    /Clearing this site's data deletes them/.test(p.footTitle ?? ""),
    `${name}: its tooltip holds the full sentence`,
  );
  check(p.oldRows === 0 && p.oldText.length === 0, `${name}: no card has the old row of buttons (${p.oldText})`);
  check(p.cards.length === 3, `${name}: one card per note`);
  for (const card of p.cards) {
    const more = card.buttons.filter((label) => label === "More actions").length;
    const go = card.buttons.filter((label) => label.startsWith("go:")).length;
    check(
      card.buttons.length <= 2 && more === 1 && go === 1,
      `${name}: card ${card.id} shows two buttons, its passage and More actions (${card.buttons.join(" | ")})`,
    );
    check(card.bar === edges[card.color], `${name}: card ${card.id}'s bar is its ${card.color} edge (${card.bar})`);
  }
  check(
    p.allButtons === 2 + p.cards.length * 2,
    `${name}: the panel shows Export, Close and two per card, nothing more (${p.allButtons})`,
  );
  check(p.transition === "0s", `${name}: the panel opens without an animation, so reduced motion has nothing to stop`);

  // 2. The accessibility tree, and axe-core over the open panel with a menu open.
  await page.click(".notes-card:first-child .notes-card__more");
  const tree = await page.locator(".notes-dialog").ariaSnapshot();
  for (const line of [
    'dialog "Notes"',
    'heading "Notes" [level=2]',
    'button "Export as Markdown"',
    'button "Close"',
    'button "More actions" [expanded]',
    'menu "Note actions"',
    'menuitem "Edit"',
    'menuitem "Share"',
    'group "Colour"',
    'menuitemradio "Amber" [checked]',
    'menuitemradio "Green"',
    'menuitem "Delete"',
  ]) {
    check(tree.includes(line), `${name}: the accessibility tree has ${line}`);
  }
  const a11y = await page.evaluate(() => {
    const dialog = document.querySelector(".notes-dialog");
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    const more = dialog.querySelector(".notes-card__more[aria-expanded='true']");
    return {
      described: document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent ?? "",
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      controls: document.getElementById(more?.getAttribute("aria-controls") ?? "")?.getAttribute("role"),
      unnamed: [...dialog.querySelectorAll("button")]
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => !(el.getAttribute("aria-label") || el.textContent.trim())).length,
      tabbable: [...dialog.querySelectorAll(".notes-menu:not([hidden]) button")].filter((el) => el.tabIndex === 0)
        .length,
    };
  });
  check(/^Saved in this browser only\. Clearing/.test(a11y.described), `${name}: the panel is described by its footer`);
  check(a11y.duplicateIds.length === 0, `${name}: no id is repeated (${a11y.duplicateIds})`);
  check(a11y.controls === "menu", `${name}: More actions controls its menu`);
  check(a11y.unnamed === 0, `${name}: every shown button has a name`);
  check(a11y.tabbable === 0, `${name}: no menu item is a tab stop`);
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(() =>
    axe
      .run(document.querySelector(".notes-dialog"), {
        runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      })
      .then((result) => result.violations.map((v) => `${v.id} (${v.nodes.length})`)),
  );
  check(violations.length === 0, `${name}: axe-core finds no violation in the panel (${violations.join(", ")})`);
  if (shots && name === "chromium desktop") {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(100);
      await page.screenshot({ path: join(shots, `after-desktop-${scheme}-menu.png`), scale: "css" });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }

  // 3. One menu at a time, and a press elsewhere closes it.
  // The open menu covers the next card, so the second menu is opened from the keyboard.
  await page.focus(".notes-card:nth-child(2) .notes-card__more");
  await page.keyboard.press("Enter");
  check(
    (await openMenus(page)) === 1 &&
      (await page.getAttribute(".notes-card:nth-child(2) .notes-card__more", "aria-expanded")) === "true",
    `${name}: opening a second menu closes the first`,
  );
  await page.click(".notes-panel__hint");
  check((await openMenus(page)) === 0, `${name}: a click elsewhere in the panel closes the menu`);

  // 4. The keyboard alone: Tab, the menu's keys, Escape.
  await page.focus(".notes-dialog__head [aria-label='Close']");
  await page.keyboard.press("Tab");
  let a = await active(page);
  check(a.action === "go" && a.card !== null, `${name}: Tab from Close reaches the first card's passage`);
  await page.keyboard.press("Tab");
  a = await active(page);
  check(a.label === "More actions", `${name}: the next Tab reaches its More actions`);
  const first = a.card;
  await page.keyboard.press("Enter");
  a = await active(page);
  check(a.role === "menuitem" && a.action === "edit", `${name}: Enter opens the menu on Edit`);
  await page.keyboard.press("ArrowDown");
  a = await active(page);
  check(a.action === "share", `${name}: ArrowDown moves to Share`);
  await page.keyboard.press("ArrowDown");
  a = await active(page);
  check(a.role === "menuitemradio" && a.text === "Amber", `${name}: then to the first colour`);
  await page.keyboard.press("ArrowRight");
  a = await active(page);
  check(a.text === "Green", `${name}: ArrowRight moves between the colours`);
  await page.keyboard.press("End");
  a = await active(page);
  check(a.action === "delete", `${name}: End reaches Delete`);
  await page.keyboard.press("ArrowDown");
  a = await active(page);
  check(a.action === "edit", `${name}: ArrowDown wraps to Edit`);
  await page.keyboard.press("Escape");
  a = await active(page);
  check(
    a.label === "More actions" && a.card === first && (await openMenus(page)) === 0,
    `${name}: Escape closes the menu and gives focus back to its button`,
  );
  check(await page.evaluate(() => document.querySelector(".notes-dialog").open), `${name}: and the panel stays open`);
  await page.keyboard.press("ArrowUp");
  a = await active(page);
  check(a.action === "delete", `${name}: ArrowUp on More actions opens the menu on its last item`);
  await page.keyboard.press("Escape");

  // 5. A colour picked from the keyboard recolours the highlight and the card at once.
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  p = await readPanel(page);
  const recoloured = p.cards.find((card) => card.id === first);
  check(
    recoloured.color === "blue" && recoloured.bar === edges.blue,
    `${name}: Blue recolours the card's bar (${recoloured.color}, ${recoloured.bar})`,
  );
  check(
    await page.evaluate((id) => {
      const stored = JSON.parse(localStorage.getItem("manual-notes")).chapters.tools.find((item) => item.id === id);
      return stored.color === "blue" && CSS.highlights.get("manual-note-blue").size === 1;
    }, first),
    `${name}: and the highlight on the page`,
  );
  a = await active(page);
  check(
    a.role === "menuitemradio" && a.text === "Blue" && (await openMenus(page)) === 1,
    `${name}: the menu stays open on the colour just picked`,
  );
  check(
    (await page.getAttribute(`.notes-card[data-id="${first}"] [data-color='blue']`, "aria-checked")) === "true",
    `${name}: and the menu shows it checked`,
  );
  await page.keyboard.press("Escape");

  // 6. Share and Export copy to the clipboard where the browser allows it.
  await page.click(".notes-card:first-child .notes-card__more");
  await page.click(".notes-card:first-child [data-action='share']");
  await page.waitForFunction(() =>
    /Copied|Select the text/.test(document.querySelector(".notes-dialog__status").textContent),
  );
  check(
    /Copied the passage|Select the text/.test(await page.textContent(".notes-dialog__status")),
    `${name}: Share copies the passage and its link`,
  );
  a = await active(page);
  check(
    a.label === "More actions" || a.cls.includes("notes-dialog__field"),
    `${name}: after Share focus returns to More actions, or to the text to copy`,
  );
  await page.click(".notes-dialog__head [aria-label='Export as Markdown']");
  await page.waitForSelector("#notes-export", { state: "visible" });
  check(/^# Notes on /.test(await page.inputValue("#notes-export")), `${name}: Export shows the Markdown`);

  // 7. Escape and a click outside close the panel; Alt+Shift+N opens it again.
  await page.keyboard.press("Escape");
  check(!(await page.evaluate(() => document.querySelector(".notes-dialog").open)), `${name}: Escape closes the panel`);
  a = await active(page);
  check(a.cls.includes("notes-open"), `${name}: and focus returns to the Notes button`);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Alt+Shift+N");
  await page.waitForSelector(".notes-dialog[open]");
  check(true, `${name}: Alt+Shift+N opens the panel`);
  await page.mouse.click(200, 500);
  check(
    !(await page.evaluate(() => document.querySelector(".notes-dialog").open)),
    `${name}: a click outside closes it`,
  );

  // 8. A card goes to its passage, below the header.
  await page.evaluate(() => scrollTo(0, 0));
  await page.click(".notes-open");
  await page.click(".notes-card:nth-child(3) .notes-card__go");
  await page.waitForTimeout(800);
  const went = await page.evaluate(() => {
    const block = document.activeElement;
    const r = block.getBoundingClientRect();
    return {
      open: document.querySelector(".notes-dialog").open,
      top: r.top,
      bottom: r.bottom,
      header: document.querySelector("[data-site-header]").getBoundingClientRect().bottom,
      h: innerHeight,
      inArticle: !!block.closest("article"),
    };
  });
  check(
    !went.open && went.inArticle && went.top >= went.header - 1 && went.top < went.h,
    `${name}: a card's passage button closes the panel and shows the passage below the header (${JSON.stringify(went)})`,
  );

  // 9. Edit opens the note popover at the passage, ready to write.
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.click(".notes-open");
  await page.click(".notes-card:first-child .notes-card__more");
  await page.click(".notes-card:first-child [data-action='edit']");
  await page.waitForSelector(".notes-pop:popover-open");
  const edit = await page.evaluate(() => {
    const pop = document.querySelector(".notes-pop").getBoundingClientRect();
    const range = [...CSS.highlights.get("manual-note-blue")][0];
    const line = range.getClientRects()[0];
    return {
      panel: document.querySelector(".notes-dialog").open,
      focus: document.activeElement === document.querySelector(".notes-pop__field"),
      value: document.querySelector(".notes-pop__field").value,
      passageTop: line.top,
      header: document.querySelector("[data-site-header]").getBoundingClientRect().bottom,
      popTop: pop.top,
      h: innerHeight,
    };
  });
  check(!edit.panel, `${name}: Edit closes the panel`);
  check(edit.focus && edit.value === NOTES[0], `${name}: and opens the popover with the note in a focused field`);
  check(
    edit.passageTop >= edit.header && edit.passageTop < edit.h && edit.popTop >= edit.header,
    `${name}: the passage was scrolled below the header and the popover sits by it (${JSON.stringify(edit)})`,
  );
  await page.keyboard.press("Escape");

  // 10. Delete deletes at once; with every note gone the panel says how to add one.
  await page.click(".notes-open");
  await page.focus(".notes-card:first-child .notes-card__more");
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  p = await readPanel(page);
  a = await active(page);
  check(p.cards.length === 2 && p.count === "2 in this chapter", `${name}: Delete removes the card at once`);
  check(a.label === "More actions" && a.card === p.cards[0].id, `${name}: focus moves to the next card's More actions`);
  check(
    await page.evaluate(
      (id) => !JSON.parse(localStorage.getItem("manual-notes")).chapters.tools.some((item) => item.id === id),
      first,
    ),
    `${name}: and the highlight is gone from storage`,
  );
  for (let i = 0; i < 2; i += 1) {
    await page.click(".notes-card:first-child .notes-card__more");
    await page.click(".notes-card:first-child [data-action='delete']");
  }
  p = await readPanel(page);
  check(
    p.cards.length === 0 &&
      p.empty === "No notes yet. Select text in the chapter, then choose Add note." &&
      p.hint === null,
    `${name}: with no notes the panel says how to add one (${p.empty})`,
  );
  check(requests.length === 0, `${name}: the page made no request outside the book (${requests.join(", ") || "none"})`);
  await context.close();

  // 11. A short window: the panel still starts below the header and its body scrolls.
  const short = await browser.newContext({ viewport: { width: 1280, height: 420 }, colorScheme: "light" });
  const shortPage = await short.newPage();
  await seeded(shortPage);
  await shortPage.evaluate(() => scrollTo(0, 900));
  await shortPage.click(".notes-open");
  await shortPage.waitForSelector(".notes-dialog[open]");
  await checkPlace(shortPage, `${name} 1280x420`, false);
  await shortPage.click(".notes-card:last-child .notes-card__more");
  const menuFits = await shortPage.evaluate(() => {
    const menu = document.querySelector(".notes-menu:not([hidden])").getBoundingClientRect();
    const body = document.querySelector(".notes-panel__body").getBoundingClientRect();
    return menu.top >= body.top - 1 && menu.bottom <= body.bottom + 1;
  });
  check(menuFits, `${name} 1280x420: the last card's menu shows whole inside the panel`);
  await short.close();
}

async function phone(browser, name) {
  const { defaultBrowserType: _ignored, ...iphone } = playwright.devices["iPhone 14"];
  const context = await browser.newContext({ ...iphone, colorScheme: "light" });
  const page = await context.newPage();
  await seeded(page);
  // A scroll down slides the phone header away; one back up brings it back. The panel follows either.
  await page.evaluate(() => scrollTo(0, 400));
  await page.waitForTimeout(300);
  await page.click(".notes-open");
  await page.waitForSelector(".notes-dialog[open]");
  await page.waitForTimeout(300);
  await checkPlace(page, name, true);
  const sizes = await page.evaluate(() => {
    const shown = (el) => el.getClientRects().length > 0 && el.closest("[hidden]") === null;
    document.querySelector(".notes-card__more").click();
    return [
      ...document.querySelectorAll(
        ".notes-dialog__head button, .notes-card__more, .notes-card__go, .notes-menu:not([hidden]) [role^='menuitem']",
      ),
    ]
      .filter(shown)
      .map((el) => Math.round(Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)));
  });
  check(
    sizes.every((size) => size >= 44),
    `${name}: every control in the panel is a 44px target (${sizes.join(",")})`,
  );
  if (shots && name === "chromium iPhone 14") await page.screenshot({ path: join(shots, "after-phone-menu.png"), scale: "css" });
  await page.keyboard.press("Escape");
  if (shots && name === "chromium iPhone 14") await page.screenshot({ path: join(shots, "after-phone.png"), scale: "css" });
  // Edit on a phone closes the full-width panel, then opens the sheet with the field ready.
  await page.click(".notes-card:first-child .notes-card__more");
  await page.click(".notes-card:first-child [data-action='edit']");
  await page.waitForSelector(".notes-pop:popover-open");
  const sheet = await page.evaluate(() => ({
    panel: document.querySelector(".notes-dialog").open,
    sheet: document.querySelector(".notes-pop").hasAttribute("data-sheet"),
    focus: document.activeElement === document.querySelector(".notes-pop__field"),
  }));
  check(
    !sheet.panel && sheet.sheet && sheet.focus,
    `${name}: Edit closes the panel and opens the sheet, field focused`,
  );
  await page.click(".notes-pop__close");
  // A tap on a card goes to its passage.
  await page.click(".notes-open");
  await page.tap(".notes-card:nth-child(2) .notes-card__go");
  await page.waitForTimeout(600);
  check(
    !(await page.evaluate(() => document.querySelector(".notes-dialog").open)),
    `${name}: a tap on a card closes the panel`,
  );
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(widths[0] <= widths[1], `${name}: the page does not scroll sideways (${widths[0]} <= ${widths[1]})`);
  await context.close();
}

async function forced(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, forcedColors: "active" });
  const page = await context.newPage();
  await seeded(page);
  await page.click(".notes-open");
  await page.click(".notes-card:first-child .notes-card__more");
  const ring = await page.evaluate(() => {
    const checked = document.querySelector(".notes-menu:not([hidden]) [aria-checked='true']");
    const before = getComputedStyle(checked, "::before");
    return { adjust: before.forcedColorAdjust, outline: before.outlineStyle };
  });
  check(
    ring.adjust === "none" && ring.outline === "solid",
    `${name} forced colours: a dot keeps its colour and the checked one keeps its ring (${JSON.stringify(ring)})`,
  );
  await context.close();
}

async function launch(type, label) {
  const browser = await type.launch({ env: browserEnv });
  try {
    await desktop(browser, `${label} desktop`);
    await phone(browser, `${label} iPhone 14`);
    if (label === "chromium") await forced(browser, label);
  } finally {
    await browser.close();
  }
}

try {
  await launch(playwright.chromium, "chromium");
  let webkitReady = false;
  try {
    const probe = await playwright.webkit.launch({ env: browserEnv });
    await probe.close();
    webkitReady = true;
  } catch (error) {
    // Only a missing build is a skip; any other launch failure fails the run.
    if (!/Executable doesn't exist/.test(String(error?.message))) throw error;
    console.log(
      "SKIPPED - webkit: no WebKit build is installed (PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit)",
    );
  }
  if (webkitReady) await launch(playwright.webkit, "webkit");
} finally {
  server.close();
}
assert.equal(failures.length, 0, `${failures.length} checks failed:\n${failures.join("\n")}`);
console.log(`all ${count} notes-panel checks passed`);
