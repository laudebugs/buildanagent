// Checks how a reader writes a new note on a desktop (the A1 design in docs/design/notes/), in desktop Chromium and,
// when a WebKit build is installed, desktop WebKit (the engine Safari uses):
//  - Add note opens only the note popover at the passage: no notes panel, no "Your notes on this chapter" title, no
//    Export button, no list, and the note field has focus, made inside the click;
//  - the popover sits under the passage's last line, flips above it near the window's foot, stays inside the reading
//    column and the window, and follows the passage when the page scrolls and the window resizes;
//  - the four colour dots are a radio group: the arrow keys and a click recolour the new highlight at once, and nothing
//    is stored until Save note;
//  - Save note, Cancel, Escape and a click outside all close it, focus is never left inside it, a keyboard reader's
//    focus goes back to the note's marker or the passage, and only Save keeps anything ("Note saved.");
//  - a resize across the sheet's width keeps the new note, its text and focus; the popover hides while its passage is
//    scrolled away and returns with it; a marker opened meanwhile drops the new note; and an empty Save note keeps a
//    note another tab put on the same passage;
//  - a highlight's own popover is the same component, and every action is reachable from the keyboard alone;
//  - the popover's roles, names and states, read from the browser's accessibility tree.
// The repo has no axe-core, so the last item is a targeted check of roles, names, labels and states, not an axe run.
//
// It needs Playwright and a built book (`pnpm --filter @buildanagent/manual build`), so `pnpm test` does not run it.
// WebKit is optional: install it with `PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit` and run with the
// same variable; without it that part is skipped with a message. `--shots <folder>` saves a screenshot of the new-note
// popover in the light and the dark theme for each browser.
//
//   node scripts/note-popover-check.mjs [--shots <folder>]   (or: pnpm --filter @buildanagent/manual check:note-popover)
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { browserEnv, loadPlaywright, selectIn, serveDist } from "./lib/browser-check.mjs";

const playwright = loadPlaywright();
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

const NOTE = "Check this against the cost cap in chapter 4.";

async function fresh(page) {
  await page.goto(`${origin}/tools/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".notes-open");
}

/** Brings the n-th long paragraph to `at` of the window's height, then selects `length` characters in it. */
async function selectAt(page, index, at, from = 10, length = 40) {
  await page.evaluate(
    ([i, where]) => {
      const p = [...document.querySelectorAll("article p")].filter((el) => el.textContent.trim().length > 200)[i];
      const top = p.getBoundingClientRect().top + scrollY;
      scrollTo({ top: top - innerHeight * where, behavior: "instant" });
    },
    [index, at],
  );
  const text = await selectIn(page, index, from, length);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  return text;
}

/** Selects the same passage again and presses Add note, which opens the popover of the highlight already on it. */
async function addNoteOn(page) {
  await selectAt(page, 3, 0.3);
  await addNote(page);
}

async function addNote(page, how = "click") {
  if (how === "click") await page.click(".notes-toolbar >> text=Add note");
  await page.waitForSelector(".notes-pop:popover-open");
}

/** The open popover, the passage it is on, the reading column and what the page holds. */
const read = (page) =>
  page.evaluate(() => {
    const pop = document.querySelector(".notes-pop");
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const column = box(document.querySelector("article p"));
    const drawn = [...CSS.highlights.entries()].filter(([name, set]) => !name.startsWith("manual-hover") && set.size);
    const passage = drawn
      .flatMap(([, set]) => [...set])
      .find((range) => range.toString().trim() === pop.querySelector(".notes-pop__quote")?.textContent);
    const lines = passage ? [...passage.getClientRects()].filter((r) => r.width > 0) : [];
    const active = document.activeElement;
    const visibleWith = (pattern) =>
      [...document.querySelectorAll("body *")].some(
        (el) =>
          el.childElementCount === 0 &&
          pattern.test(el.textContent) &&
          el.checkVisibility?.() !== false &&
          el.getClientRects().length > 0,
      );
    return {
      open: pop.matches(":popover-open"),
      hidden: getComputedStyle(pop).visibility === "hidden",
      sheet: pop.hasAttribute("data-sheet"),
      fieldValue: pop.querySelector(".notes-pop__field")?.value ?? "",
      display: getComputedStyle(pop).display,
      label: pop.getAttribute("aria-label"),
      side: pop.getAttribute("data-side"),
      rect: box(pop),
      column,
      first: lines[0] ? { top: lines[0].top, bottom: lines[0].bottom, left: lines[0].left } : null,
      last: lines.at(-1) ? { top: lines.at(-1).top, bottom: lines.at(-1).bottom, left: lines.at(-1).left } : null,
      viewport: { w: document.documentElement.clientWidth, h: innerHeight },
      panelOpen: document.querySelector(".notes-dialog").open,
      titleShown: visibleWith(/Your notes on this chapter/),
      exportShown: visibleWith(/Export/),
      activeTag: active
        ? `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ""}.${active.className}`
        : "none",
      activeInPop: Boolean(active?.closest(".notes-pop")),
      activeRole: active?.getAttribute("role") ?? "",
      activeText: active?.textContent ?? "",
      painted: Object.fromEntries(drawn.map(([name, set]) => [name, [...set].map((r) => r.toString().trim())])),
      stored: JSON.parse(localStorage.getItem("manual-notes") ?? "null"),
      live: document.querySelector("[data-notes-ui][role='status'].visually-hidden")?.textContent ?? "",
      count: pop.querySelector(".notes-pop__count")?.textContent ?? "",
      markers: document.querySelectorAll(".notes-marker, .notes-dot").length,
    };
  });

const storedNotes = (s) => Object.values(s.stored?.chapters ?? {}).flat();
const paintedCount = (s) => Object.values(s.painted).flat().length;

/** The popover is under the passage (or above it), inside the column and the window. */
function checkPlaced(s, label, side) {
  const near = (a, b) => Math.abs(a - b) <= 1.5;
  if (side === "below") {
    check(
      s.side === "below" && near(s.rect.top, s.last.bottom + 8),
      `${label}: under the passage's last line (${s.rect.top} vs ${s.last?.bottom})`,
    );
  } else {
    check(
      s.side === "above" && near(s.rect.bottom, s.first.top - 8),
      `${label}: above the passage's first line (${s.rect.bottom} vs ${s.first?.top})`,
    );
  }
  check(
    s.rect.left >= Math.max(8, s.column.left) - 0.5 && s.rect.right <= Math.min(s.viewport.w - 8, s.column.right) + 0.5,
    `${label}: inside the reading column and the window (${Math.round(s.rect.left)}..${Math.round(s.rect.right)} in ${Math.round(s.column.left)}..${Math.round(s.column.right)})`,
  );
  check(s.rect.top >= 8 && s.rect.bottom <= s.viewport.h - 8 + 0.5, `${label}: inside the window's height`);
}

function checkClosed(s, label) {
  check(!s.open && s.display === "none", `${label}: the popover is closed (${s.display})`);
  check(!s.activeInPop, `${label}: focus is not left inside it (${s.activeTag})`);
}

async function run(name, context) {
  const page = await context.newPage();
  // Records what has focus once the page's own click handlers have run, so a focus() deferred to a frame is caught.
  await page.addInitScript(() => {
    window.addEventListener("click", () => {
      const a = document.activeElement;
      window.__atClick = a ? `${a.tagName.toLowerCase()}#${a.id}` : "none";
    });
  });
  await fresh(page);

  // 1. Add note opens only the note popover, with focus in the field.
  const quote = await selectAt(page, 2, 0.3);
  await addNote(page);
  let s = await read(page);
  check(s.open && s.label === "New note", `${name}: Add note opens the new-note popover`);
  check(!s.panelOpen, `${name}: the notes panel stays closed`);
  check(!s.titleShown, `${name}: no element shows "Your notes on this chapter"`);
  check(!s.exportShown, `${name}: no Export button or text is shown`);
  check(
    (await page.locator(".notes-pop .notes-dialog__list, .notes-pop ol, .notes-pop h2").count()) === 0,
    `${name}: the popover holds no list and no title`,
  );
  check(s.activeTag.startsWith("textarea#notes-pop-field"), `${name}: the note field has focus (${s.activeTag})`);
  check(
    (await page.evaluate(() => window.__atClick)) === "textarea#notes-pop-field",
    `${name}: the field took focus inside the click`,
  );
  check(s.count === "0 / 500", `${name}: the count reads 0 / 500 (${s.count})`);
  check(
    (await page.locator(".notes-pop__hint").textContent()) === "Esc to cancel" &&
      (await page.locator(".notes-pop__hint").isVisible()),
    `${name}: the popover says Esc cancels`,
  );
  const visibleActions = await page.$$eval(".notes-pop__act", (all) =>
    all.filter((el) => el.getClientRects().length > 0).map((el) => el.textContent),
  );
  check(
    visibleActions.join("|") === "Save note|Cancel",
    `${name}: the actions are Save note and Cancel (${visibleActions})`,
  );
  check(
    (s.painted["manual-hl-amber"] ?? []).includes(quote.trim()) && s.stored === null,
    `${name}: the new highlight is drawn in amber and nothing is stored`,
  );
  checkPlaced(s, `${name} new note`, "below");

  // 2. The accessibility tree: a named dialog, a named radio group of four named radios, a labelled field.
  const tree = await page.locator(".notes-pop").ariaSnapshot();
  for (const line of [
    'dialog "New note"',
    'radiogroup "Highlight colour"',
    'radio "Amber" [checked]',
    'radio "Green"',
    'radio "Blue"',
    'radio "Pink"',
    'textbox "Note"',
    'button "Save note"',
    'button "Cancel"',
  ]) {
    check(tree.includes(line), `${name}: the accessibility tree has ${line}`);
  }
  const a11y = await page.evaluate(() => {
    const pop = document.querySelector(".notes-pop");
    const field = pop.querySelector("textarea");
    const described = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    const unnamed = [...pop.querySelectorAll("button")]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => !(el.getAttribute("aria-label") || el.textContent.trim()));
    return {
      described: described?.textContent ?? null,
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      unnamed: unnamed.length,
      tabStops: [...pop.querySelectorAll("[role='radio']")].filter((el) => el.tabIndex === 0).length,
    };
  });
  check(a11y.described === "0 / 500", `${name}: the field is described by its count`);
  check(a11y.duplicateIds.length === 0, `${name}: no id is repeated (${a11y.duplicateIds})`);
  check(a11y.unnamed === 0, `${name}: every shown button has a name`);
  check(a11y.tabStops === 1, `${name}: the colours are one tab stop`);

  // 3. The colours: the keyboard and a click recolour the new highlight live, and store nothing.
  await page.keyboard.press("Shift+Tab");
  s = await read(page);
  check(
    s.activeRole === "radio" && s.activeText === "Amber",
    `${name}: Shift+Tab from the field reaches the checked colour`,
  );
  await page.keyboard.press("ArrowRight");
  s = await read(page);
  check(
    (s.painted["manual-hl-green"] ?? []).includes(quote.trim()) && !(s.painted["manual-hl-amber"] ?? []).length,
    `${name}: ArrowRight turns the highlight green at once`,
  );
  check(s.activeText === "Green" && s.stored === null, `${name}: focus follows the arrow, and nothing is stored`);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  s = await read(page);
  check((s.painted["manual-hl-pink"] ?? []).includes(quote.trim()), `${name}: ArrowLeft wraps round to pink`);
  await page.click(".notes-pop [role='radio'][data-color='blue']");
  s = await read(page);
  check(
    (s.painted["manual-hl-blue"] ?? []).includes(quote.trim()) && paintedCount(s) === 1 && s.stored === null,
    `${name}: a click turns it blue, and only the one highlight is drawn`,
  );
  check(
    (await page.getAttribute(".notes-pop [data-color='blue']", "aria-checked")) === "true",
    `${name}: the blue dot is checked`,
  );
  await page.focus(".notes-pop__field");
  await page.keyboard.type(NOTE);
  s = await read(page);
  check(s.count === `${NOTE.length} / 500`, `${name}: the count follows the typing (${s.count})`);
  if (shots) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(100);
      await page.screenshot({
        path: join(shots, `after-desktop-${scheme}${name.includes("webkit") ? "-webkit" : ""}.png`),
      });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }

  // 4. The popover follows its passage on a scroll and a resize.
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(250);
  s = await read(page);
  checkPlaced(s, `${name} after a scroll`, "below");
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(250);
  s = await read(page);
  checkPlaced(s, `${name} after a resize`, "below");
  check(s.open && s.activeInPop, `${name}: a resize keeps the popover open and focus in it`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);

  // 4b. A resize across the sheet's width, with text typed, turns the popover into the sheet and back, keeping the new
  //     note, its text, its colour and focus.
  for (const [width, sheet] of [
    [600, true],
    [1280, false],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    s = await read(page);
    check(
      s.open && s.sheet === sheet,
      `${name} at ${width}px: the new note is ${sheet ? "a sheet" : "a popover"}, still open`,
    );
    check(s.fieldValue === NOTE, `${name} at ${width}px: the typed text is kept`);
    check(s.activeTag.startsWith("textarea#notes-pop-field"), `${name} at ${width}px: focus stays in the field`);
    check(
      (s.painted["manual-hl-blue"] ?? []).includes(quote.trim()) && s.stored === null,
      `${name} at ${width}px: the blue draft is still drawn and nothing is stored`,
    );
  }
  checkPlaced(s, `${name} back from the sheet`, "below");

  // 4c. With the passage scrolled out of the window the popover hides, still open; it returns with the passage.
  await page.evaluate(() => scrollBy({ top: 2500, behavior: "instant" }));
  await page.waitForTimeout(250);
  s = await read(page);
  check(s.open && s.hidden, `${name}: with the passage scrolled away the popover is hidden but open`);
  await page.evaluate(() => scrollBy({ top: -2500, behavior: "instant" }));
  await page.waitForTimeout(250);
  s = await read(page);
  check(s.open && !s.hidden, `${name}: it shows again when the passage returns`);
  checkPlaced(s, `${name} after the passage returns`, "below");
  check(
    s.fieldValue === NOTE && s.activeTag.startsWith("textarea#notes-pop-field"),
    `${name}: with its text and focus`,
  );

  // 5. Escape drops the new note: nothing stored, no highlight, focus back at the passage.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  s = await read(page);
  checkClosed(s, `${name} Escape`);
  check(paintedCount(s) === 0 && s.stored === null, `${name} Escape: no highlight is left and nothing is stored`);
  check(s.activeTag.startsWith("p"), `${name} Escape: focus goes back to the passage's paragraph (${s.activeTag})`);

  // 6. Cancel drops it the same way.
  await selectAt(page, 2, 0.3);
  await addNote(page);
  await page.fill(".notes-pop__field", "Not kept.");
  await page.click(".notes-pop__act[data-action='cancel']");
  await page.waitForTimeout(100);
  s = await read(page);
  checkClosed(s, `${name} Cancel`);
  check(paintedCount(s) === 0 && s.stored === null, `${name} Cancel: no highlight is left and nothing is stored`);

  // 7. A click outside drops it too, and focus stays where the reader clicked.
  await selectAt(page, 2, 0.3);
  await addNote(page);
  await page.fill(".notes-pop__field", "Not kept either.");
  await page.mouse.click(s.viewport.w - 40, 40);
  await page.waitForTimeout(150);
  s = await read(page);
  checkClosed(s, `${name} click outside`);
  check(
    paintedCount(s) === 0 && s.stored === null,
    `${name} click outside: no highlight is left and nothing is stored`,
  );

  // 8. Near the window's foot the popover flips above the passage.
  await selectAt(page, 3, 0.9);
  await addNote(page);
  s = await read(page);
  check(
    s.last.bottom + 8 + s.rect.height > s.viewport.h - 8,
    `${name}: the passage is too near the window's foot for the popover to fit below`,
  );
  checkPlaced(s, `${name} near the foot`, "above");
  await page.keyboard.press("Escape");

  // 9. A passage near the column's right edge keeps the popover inside the column.
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("article p")].filter((el) => el.textContent.trim().length > 200)[2];
    p.scrollIntoView({ block: "center", behavior: "instant" });
  });
  const edge = await page.evaluate(() => {
    const p = [...document.querySelectorAll("article p")].filter((el) => el.textContent.trim().length > 200)[2];
    const right = document.querySelector("article p").getBoundingClientRect().right;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest("[aria-hidden='true'], [data-pagefind-ignore], code, a")) continue;
      for (let i = 0; i + 6 < node.data.length; i += 1) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 6);
        const rects = range.getClientRects();
        if (rects.length === 1 && rects[0].left > right - 120) {
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          return rects[0].left;
        }
      }
    }
    return null;
  });
  check(edge !== null, `${name}: found a passage near the column's right edge (${edge})`);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await addNote(page);
  s = await read(page);
  check(s.rect.left < s.last.left, `${name}: the popover is pulled left of a passage at the column's edge`);
  checkPlaced(s, `${name} at the column's edge`, "below");
  await page.keyboard.press("Escape");

  // 10. Save note keeps it, in the colour left checked, and says so.
  const saved = await selectAt(page, 2, 0.3);
  await addNote(page);
  await page.click(".notes-pop [role='radio'][data-color='green']");
  await page.fill(".notes-pop__field", NOTE);
  await page.click(".notes-pop__act[data-action='save']");
  await page.waitForTimeout(150);
  s = await read(page);
  checkClosed(s, `${name} Save`);
  check(s.live === "Note saved.", `${name} Save: the live region says "Note saved." (${s.live})`);
  const first = storedNotes(s)[0];
  check(
    storedNotes(s).length === 1 && first?.note === NOTE && first?.color === "green" && first?.quote === saved.trim(),
    `${name} Save: the highlight is stored once, green, with its note`,
  );
  check(s.markers === 1 && (s.painted["manual-note-green"] ?? []).length === 1, `${name} Save: it has its marker`);

  // 11. The saved highlight opens the same component; Escape closes it through the same path.
  await page.locator(".notes-marker, .notes-dot").first().click();
  await page.waitForSelector(".notes-pop:popover-open");
  s = await read(page);
  check(s.label === "Highlight", `${name}: a highlight's popover is labelled Highlight`);
  check((await page.locator(".notes-pop [role='radio']").count()) === 4, `${name}: it has the same four colour radios`);
  checkPlaced(s, `${name} saved highlight`, "below");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  s = await read(page);
  checkClosed(s, `${name} Escape on a saved note`);
  check(
    s.activeTag.includes("notes-marker") || s.activeTag.includes("notes-dot"),
    `${name}: Escape gives focus to the marker`,
  );

  // 11b. Opening a marker while a new note is open drops the new note and opens the highlight.
  await selectAt(page, 3, 0.3);
  await addNote(page);
  await page.fill(".notes-pop__field", "Typed, then left.");
  await page.focus(".notes-marker, .notes-dot");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  s = await read(page);
  check(s.open && s.label === "Highlight", `${name}: Enter on a marker opens that highlight instead`);
  check(
    paintedCount(s) === 1 && s.fieldValue !== "Typed, then left.",
    `${name}: the new note's draft and text are gone`,
  );
  await page.keyboard.press("Escape");

  // 11c. Another tab notes the same passage while this one has a new note open with an empty field: Save note keeps the
  //      other tab's note and colour.
  const passage = await selectAt(page, 3, 0.3);
  await addNote(page);
  const other = await page.context().newPage();
  await other.goto(`${origin}/tools/`);
  await other.waitForSelector(".notes-open");
  await selectAt(other, 3, 0.3);
  await other.click(".notes-toolbar .notes-swatch--pink");
  await addNoteOn(other);
  await other.fill(".notes-pop__field", "important");
  await other.click(".notes-pop__act[data-action='save']");
  await other.close();
  await page.click(".notes-pop__act[data-action='save']");
  await page.waitForTimeout(150);
  s = await read(page);
  const both = storedNotes(s).filter((item) => item.quote === passage.trim());
  check(
    both.length === 1 && both[0].note === "important" && both[0].color === "pink",
    `${name}: an empty Save note keeps the other tab's note and colour (${JSON.stringify(both.map((i) => [i.note, i.color]))})`,
  );

  // 12. From the keyboard alone: select, Alt+Shift+N, Tab to Add note, write, choose a colour, Tab to Save note.
  await fresh(page);
  await selectAt(page, 2, 0.3);
  await page.keyboard.press("Alt+Shift+N");
  const toolbarFocus = await page.evaluate(() => Boolean(document.activeElement?.closest(".notes-toolbar")));
  check(toolbarFocus, `${name}: Alt+Shift+N moves focus into the toolbar`);
  for (let i = 0; i < 6; i += 1) {
    if ((await page.evaluate(() => document.activeElement?.textContent)) === "Add note") break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await page.waitForSelector(".notes-pop:popover-open");
  s = await read(page);
  check(
    s.activeTag.startsWith("textarea#notes-pop-field"),
    `${name} keyboard: Enter on Add note puts focus in the field`,
  );
  await page.keyboard.type("From the keyboard.");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  s = await read(page);
  check(s.activeText === "Save note", `${name} keyboard: Tab reaches Save note (${s.activeText})`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  s = await read(page);
  checkClosed(s, `${name} keyboard Save`);
  check(
    storedNotes(s)[0]?.note === "From the keyboard." && storedNotes(s)[0]?.color === "pink",
    `${name} keyboard: the note is saved in pink, the colour End chose`,
  );
  check(
    s.activeTag.includes("notes-marker") || s.activeTag.includes("notes-dot"),
    `${name} keyboard: focus goes to the new note's marker (${s.activeTag})`,
  );
  await page.close();
}

async function launch(type, name) {
  const browser = await type.launch({ env: browserEnv });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  try {
    await run(name, context);
  } finally {
    await browser.close();
  }
}

try {
  await launch(playwright.chromium, "chromium desktop");
  let webkitReady = false;
  try {
    const probe = await playwright.webkit.launch({ env: browserEnv });
    await probe.close();
    webkitReady = true;
  } catch (error) {
    // Only a missing build is a skip; any other launch failure fails the run.
    if (!/Executable doesn't exist/.test(String(error?.message))) throw error;
    console.log(
      "SKIPPED - webkit desktop: no WebKit build is installed (PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit)",
    );
  }
  if (webkitReady) await launch(playwright.webkit, "webkit desktop");
} finally {
  server.close();
}
assert.equal(failures.length, 0, `${failures.length} checks failed:\n${failures.join("\n")}`);
console.log(`all ${count} note-popover checks passed`);
