// Checks the note editor's flow, in desktop and iPhone 14 touch Chromium and, when a WebKit build is installed, in
// iPhone 14 WebKit (the engine Safari uses):
//  - the note field has focus as soon as the add-note sheet opens, and on Edit with the caret at the end of the note;
//  - Save, Remove, the Close button, Escape and a swipe down all close the editor, leave it display:none and out of
//    the way, move focus out of it, never jump the page, and can be followed by opening it again without a reload;
//  - Save and Remove say "Note saved." and "Note removed." in the page's live region and persist across a reload;
//  - the Close button (sheet only) is a named 44px target clear of the colours and the quotation, works from the
//    keyboard, and drops unsaved text exactly as Escape and a swipe do;
//  - with the window as short as a phone with its keyboard open, the field and the actions stay in view.
//
// It needs Playwright and a built book (`pnpm --filter @buildanagent/manual build`), so `pnpm test` does not run it.
// WebKit is optional: install it with `PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit` and run with the
// same variable; without it that part is skipped with a message. No run here can show the real iOS keyboard, whose
// opening depends on the focus() call being inside the tap. The checks do prove the call is made there: a listener on
// the window, which runs after the page's own click handlers, records document.activeElement at the end of each click
// dispatch, so a focus() deferred to a frame or a timer is caught.
//
//   node scripts/note-editor-flow-check.mjs
import assert from "node:assert/strict";
import { browserEnv, loadPlaywright, selectIn, serveDist } from "./lib/browser-check.mjs";

const playwright = loadPlaywright();
const { server, origin } = await serveDist();
const failures = [];
let count = 0;
const check = (condition, message) => {
  count += 1;
  console.log(`${condition ? "ok" : "NOT OK"} - ${message}`);
  if (!condition) failures.push(message);
};

const { defaultBrowserType: _ignored, ...phone } = playwright.devices["iPhone 14"];
const NOTE = "A short note on this passage.";

/** A fresh chapter page with no stored notes. */
async function fresh(page) {
  await page.goto(`${origin}/tools/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".notes-open");
}

/** Highlights 70 characters of a paragraph in blue and returns nothing; the toolbar's swatch does the work. */
async function highlight(page) {
  await selectIn(page, 2, 10, 70);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  await page.click(".notes-toolbar .notes-swatch--blue");
}

/** Scrolls the highlight to the middle and gives the point to tap on it. */
const passagePoint = (page) =>
  page.evaluate(() => {
    const range = [...CSS.highlights.entries()].filter(([, set]) => set.size).map(([, set]) => [...set][0])[0];
    range.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = range.getClientRects()[0];
    return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + rect.height / 2 };
  });

/** A tap, or a click on a desktop. */
const press = (page, mobile, x, y) => (mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

/** Opens the popover by pressing the highlight itself. */
async function openOnPassage(page, mobile) {
  const p = await passagePoint(page);
  await press(page, mobile, p.x, p.y);
  await page.waitForSelector(".notes-pop:popover-open");
}

/** Opens the popover by pressing the note's marker (a margin bubble, or a dot after the passage). */
async function openOnMarker(page, mobile) {
  const box = await page.locator(".notes-marker, .notes-dot").first().boundingBox();
  await press(page, mobile, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector(".notes-pop:popover-open");
}

const state = (page) =>
  page.evaluate(() => {
    const pop = document.querySelector(".notes-pop");
    const active = document.activeElement;
    return {
      open: pop.matches(":popover-open"),
      display: getComputedStyle(pop).display,
      sheet: pop.hasAttribute("data-sheet"),
      activeInPop: Boolean(active?.closest(".notes-pop")),
      activeTag: active ? `${active.tagName.toLowerCase()}.${active.className}` : "none",
      live: document.querySelector("[role='status'].visually-hidden")?.textContent ?? "",
      scrollY: Math.round(scrollY),
      hovered: [...CSS.highlights.entries()].filter(([k, set]) => k.startsWith("manual-hover") && set.size).length,
      highlights: [...CSS.highlights.entries()]
        .filter(([k]) => !k.startsWith("manual-hover"))
        .map(([, set]) => set)
        .reduce((sum, set) => sum + set.size, 0),
      controls: document.querySelectorAll(".notes-marker, .notes-dot").length,
      stored: JSON.parse(localStorage.getItem("manual-notes") ?? "null"),
    };
  });

const storedNotes = (s) => Object.values(s.stored?.chapters ?? {}).flat();

/** What a closed editor must look like: not open, display none (so it covers nothing), no focus inside it. */
function checkClosed(s, label) {
  check(!s.open && s.display === "none", `${label}: the editor is closed and display:none (${s.display})`);
  check(!s.activeInPop, `${label}: focus is not left in the editor (${s.activeTag})`);
}

async function run(label, context, mobile) {
  const page = await context.newPage();
  // Records what has focus when the page's own click handlers have run, before any timer or frame could move it.
  await page.addInitScript(() => {
    window.addEventListener("click", () => {
      const a = document.activeElement;
      window.__atClick = a ? `${a.tagName.toLowerCase()}#${a.id}.${a.className}` : "none";
    });
  });
  const atClick = () => page.evaluate(() => window.__atClick);
  await fresh(page);

  // 1. Add note from the toolbar puts focus in the note field, inside the tap.
  await selectIn(page, 2, 10, 70);
  await page.waitForSelector(".notes-toolbar:not([hidden])");
  const addNote = page.locator(".notes-toolbar >> text=Add note");
  if (mobile) await addNote.tap();
  else await addNote.click();
  await page.waitForSelector("#notes-field", { state: "visible" });
  check(
    (await page.evaluate(() => document.activeElement?.id)) === "notes-field",
    `${label}: Add note opens with focus in the note field`,
  );
  check(
    (await atClick()).startsWith("textarea#notes-field"),
    `${label}: Add note focuses it inside the click (${await atClick()})`,
  );
  await page.keyboard.press("Escape");
  await fresh(page);

  // 2. A plain highlight's editor opens with focus in the field.
  await highlight(page);
  await openOnPassage(page, mobile);
  let s = await state(page);
  check(s.activeTag === "textarea.notes-pop__field", `${label}: the add-note editor opens with focus in the field`);
  check(
    (await atClick()).startsWith("textarea#.notes-pop__field"),
    `${label}: the field is focused inside the tap that opened it, not later (${await atClick()})`,
  );
  check(s.sheet === mobile, `${label}: the editor is a ${mobile ? "sheet" : "popover"}`);

  // 3. Escape closes it and leaves the highlight.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  s = await state(page);
  checkClosed(s, `${label} Escape`);
  check(s.highlights === 1, `${label} Escape: the highlight stays`);

  // 4. The keyboard's height: the field and the actions stay in view.
  if (mobile) {
    await openOnPassage(page, mobile);
    const full = phone.viewport.height;
    await page.setViewportSize({ width: phone.viewport.width, height: 420 });
    await page.waitForTimeout(300);
    const k = await page.evaluate(() => {
      const f = document.querySelector(".notes-pop__field").getBoundingClientRect();
      const a = document.querySelector(".notes-pop__actions").getBoundingClientRect();
      return { fTop: f.top, fBottom: f.bottom, aTop: a.top, aBottom: a.bottom, vh: innerHeight };
    });
    check(k.fTop >= 0 && k.fBottom <= k.vh + 1, `${label}: in a 420px window the field is in view`);
    check(k.aTop >= 0 && k.aBottom <= k.vh + 1, `${label}: in a 420px window the actions are in view`);
    await page.setViewportSize({ width: phone.viewport.width, height: full });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }

  // 5. Close with a swipe down (a sheet only), then open again with no reload.
  if (mobile) {
    await openOnPassage(page, mobile);
    const grab = await page.locator(".notes-pop__grab").boundingBox();
    const x = grab.x + grab.width / 2;
    await page.mouse.move(x, grab.y + 10);
    await page.mouse.down();
    await page.mouse.move(x, grab.y + 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    s = await state(page);
    checkClosed(s, `${label} swipe`);
    check(s.highlights === 1, `${label} swipe: the highlight stays`);
  }

  // 6. Save: persists, closes, blurs, announces, keeps the marker, does not scroll, and the editor opens again.
  await openOnPassage(page, mobile);
  await page.fill(".notes-pop__field", NOTE);
  const before = (await state(page)).scrollY;
  await page.click(".notes-pop__act[data-action='save']");
  await page.waitForTimeout(150);
  s = await state(page);
  checkClosed(s, `${label} Save`);
  if (!mobile) {
    check(
      !s.activeTag.includes("notes-marker"),
      `${label} Save: a mouse Save leaves no margin marker focused (${s.activeTag})`,
    );
    check(s.hovered === 0, `${label} Save: no passage is left brightened by a hover or focus shade`);
  }
  check(s.live === "Note saved.", `${label} Save: the live region says "Note saved." (${s.live})`);
  check(s.controls === 1, `${label} Save: the note's marker is there`);
  check(Math.abs(s.scrollY - before) <= 4, `${label} Save: the page did not jump (${before} to ${s.scrollY})`);
  check(storedNotes(s)[0]?.note === NOTE, `${label} Save: the note is stored`);
  await page.reload();
  await page.waitForSelector(".notes-open");
  s = await state(page);
  check(
    storedNotes(s)[0]?.note === NOTE && s.controls === 1,
    `${label} Save: the note and its marker survive a reload`,
  );

  // 7. Reopen on the marker: the saved view; Edit puts the caret at the end of the note.
  await openOnMarker(page, mobile);
  check(
    (await page.evaluate(() => document.querySelector(".notes-pop__note").textContent)) === NOTE,
    `${label}: the marker opens the saved note`,
  );
  await page.click(".notes-pop__act[data-action='edit']");
  s = await state(page);
  const caret = await page.evaluate(() => {
    const f = document.querySelector(".notes-pop__field");
    return [f.selectionStart, f.selectionEnd, f.value.length];
  });
  check(s.activeTag === "textarea.notes-pop__field", `${label} Edit: focus is in the field`);
  check(
    (await atClick()).startsWith("textarea#.notes-pop__field"),
    `${label} Edit: the field is focused inside the Edit press (${await atClick()})`,
  );
  check(caret[0] === caret[2] && caret[1] === caret[2], `${label} Edit: the caret is at the end (${caret})`);

  // 8. The Close button: a sheet has it, a popover does not.
  const closeBox = await page.evaluate(() => {
    const close = document.querySelector(".notes-pop__close");
    const r = close.getBoundingClientRect();
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return el.getClientRects().length ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null;
    };
    const others = [".notes-colors", ".notes-pop__quote", ".notes-pop__grab span"].map((q) =>
      rect(document.querySelector(q)),
    );
    const mine = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    const hit = others.some((o) => o && mine.l < o.r && o.l < mine.r && mine.t < o.b && o.t < mine.b);
    return {
      shown: close.getClientRects().length > 0,
      w: r.width,
      h: r.height,
      name: close.getAttribute("aria-label"),
      overlaps: hit,
      inside: r.right <= innerWidth && r.top >= 0,
    };
  });
  if (mobile) {
    check(closeBox.shown && closeBox.name === "Close note", `${label} edit state: the Close note button is shown`);
    check(closeBox.w >= 44 && closeBox.h >= 44, `${label}: Close is at least 44x44 (${closeBox.w}x${closeBox.h})`);
    check(!closeBox.overlaps && closeBox.inside, `${label}: Close does not overlap the colours, quotation or handle`);
    // Unsaved text is dropped, as Escape and a swipe drop it.
    await page.fill(".notes-pop__field", `${NOTE} More, not saved.`);
    const b = await page.locator(".notes-pop__close").boundingBox();
    await press(page, mobile, b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(150);
    s = await state(page);
    checkClosed(s, `${label} Close (editing)`);
    check(
      storedNotes(s)[0]?.note === NOTE,
      `${label} Close: the unsaved text was dropped, as Escape and a swipe drop it`,
    );
    check(s.highlights === 1 && s.controls === 1, `${label} Close: the highlight and marker stay`);
    // The saved view has the button too, and the keyboard closes it.
    await openOnMarker(page, mobile);
    check(
      await page.evaluate(() => document.querySelector(".notes-pop__close").getClientRects().length > 0),
      `${label} saved view: the Close note button is shown`,
    );
    for (const key of ["Enter", " "]) {
      await page.focus(".notes-pop__close");
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
      s = await state(page);
      checkClosed(s, `${label} Close by ${key === " " ? "Space" : key}`);
      await openOnMarker(page, mobile);
    }
  } else {
    check(!closeBox.shown, `${label}: a popover has no Close button (it closes on Escape and an outside click)`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    await openOnMarker(page, mobile);
  }

  // 9. Remove: deletes the note and its highlight, closes, announces, persists, and the page does not jump.
  const beforeRemove = (await state(page)).scrollY;
  await page.click(".notes-pop__act[data-action='delete']");
  await page.waitForTimeout(150);
  s = await state(page);
  checkClosed(s, `${label} Remove`);
  check(s.live === "Note removed.", `${label} Remove: the live region says "Note removed." (${s.live})`);
  check(s.highlights === 0 && s.controls === 0, `${label} Remove: the highlight and its marker are gone`);
  check(
    Math.abs(s.scrollY - beforeRemove) <= 4,
    `${label} Remove: the page did not jump (${beforeRemove} to ${s.scrollY})`,
  );
  await page.reload();
  await page.waitForSelector(".notes-open");
  s = await state(page);
  check(storedNotes(s).length === 0 && s.highlights === 0, `${label} Remove: the removal survives a reload`);

  // 10. After all of that a new highlight still opens an editor: nothing was left over.
  await highlight(page);
  await openOnPassage(page, mobile);
  s = await state(page);
  check(s.open && s.activeTag === "textarea.notes-pop__field", `${label}: the editor opens again after every close`);
  await page.keyboard.press("Escape");
  await page.close();
}

async function launch(type, name, mobile, env) {
  const browser = await type.launch({ env });
  const context = await browser.newContext(
    mobile
      ? { ...phone, colorScheme: "light" }
      : { viewport: { width: 1280, height: 900 }, colorScheme: "light", permissions: [] },
  );
  try {
    await run(name, context, mobile);
  } finally {
    await browser.close();
  }
}

try {
  await launch(playwright.chromium, "chromium desktop", false, browserEnv);
  await launch(playwright.chromium, "chromium iPhone 14", true, browserEnv);
  let webkitReady = false;
  try {
    const probe = await playwright.webkit.launch({ env: browserEnv });
    await probe.close();
    webkitReady = true;
  } catch {
    console.log(
      "SKIPPED - webkit iPhone 14: no WebKit build is installed (PLAYWRIGHT_BROWSERS_PATH=<dir> npx playwright install webkit)",
    );
  }
  if (webkitReady) await launch(playwright.webkit, "webkit iPhone 14", true, browserEnv);
} finally {
  server.close();
}
assert.equal(failures.length, 0, `${failures.length} checks failed:\n${failures.join("\n")}`);
console.log(`all ${count} note-editor checks passed`);
