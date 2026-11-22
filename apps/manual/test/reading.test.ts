import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, test, vi } from "vitest";
import {
  furthestId,
  KEY,
  parseStored,
  passedIndex,
  resumeHref,
  resumeTarget,
  SETTLE_MS,
  serializeStored,
  start,
} from "../public/scripts/reading.js";

// public/scripts/reading.js keeps a reader's place in a chapter and offers it back on the Contents page. Its pure
// functions are tested on their own, then start() runs in a happy-dom window over a small chapter and a small
// Contents page, with an in-memory localStorage, a storage that throws, and network APIs that fail the test.

type Place = { id: string; text: string; at: number };

const stored = (chapters: Record<string, unknown>) => JSON.stringify({ v: 1, chapters });

test("a stored value that is missing, damaged or of another shape reads as no place at all", () => {
  for (const raw of [
    null,
    undefined,
    "",
    "{",
    "null",
    "[]",
    '"text"',
    "42",
    '{"v":2,"chapters":{}}',
    '{"chapters":{"tools":{"id":"a","text":"A","at":1}}}',
    '{"v":1,"chapters":[]}',
    '{"v":1,"chapters":null}',
  ]) {
    assert.equal(parseStored(raw).size, 0, String(raw));
  }
});

test("each malformed entry is dropped and the well-formed ones are kept", () => {
  const places = parseStored(
    stored({
      tools: { id: "identity", text: "Identity", at: 5 },
      "Not-A-Slug": { id: "a", text: "A", at: 1 },
      "../evil": { id: "a", text: "A", at: 1 },
      "memory-and-sessions": { id: "", text: "A", at: 1 },
      "call-workflow-loop": { id: "has space", text: "A", at: 1 },
      "talking-to-a-model": { id: "a", text: 3, at: 1 },
      "stopping-and-structured-output": { id: "a", text: "A", at: "1" },
      "testing-offline": { id: "x".repeat(201), text: "A", at: 1 },
      "approvals-guardrails-and-injection": null,
    }),
  );
  assert.deepEqual([...places.keys()], ["tools"]);
  assert.deepEqual(places.get("tools"), { id: "identity", text: "Identity", at: 5 });
  const proto = parseStored('{"v":1,"chapters":{"__proto__":{"id":"a","text":"A","at":1}}}');
  assert.equal(proto.size, 0, "a __proto__ key is not a chapter");
  assert.equal(({} as Record<string, unknown>).id, undefined, "and it changes no prototype");
});

test("a stored heading's text is cut to 300 characters, and serializing reads back the same places", () => {
  const places = parseStored(stored({ tools: { id: "a", text: "t".repeat(400), at: 2 } }));
  assert.equal(places.get("tools")?.text.length, 300);
  const again = parseStored(serializeStored(places));
  assert.deepEqual([...again], [...places]);
});

test("the heading reached is the last one at or above the viewport's top, or none above the first", () => {
  assert.equal(passedIndex([]), -1);
  assert.equal(passedIndex([40, 900, 1800]), -1, "the reader is still above the first heading");
  assert.equal(passedIndex([0, 900, 1800]), 0, "a heading that a fragment link put at the top counts as reached");
  assert.equal(passedIndex([-1200, -300, 400]), 1);
  assert.equal(passedIndex([-3000, -2000, -10]), 2);
});

test("the place kept is the furthest of the stored heading and the one reached, and a vanished id counts as the start", () => {
  const ids = ["one", "two", "three"];
  assert.equal(furthestId(ids, undefined, -1), undefined);
  assert.equal(furthestId(ids, undefined, 0), "one");
  assert.equal(furthestId(ids, "three", 1), "three", "scrolling back up keeps the furthest place");
  assert.equal(furthestId(ids, "one", 2), "three");
  assert.equal(furthestId(ids, "removed", -1), undefined);
  assert.equal(furthestId(ids, "removed", 1), "two");
});

test("the chapter to resume is the one written most recently that the book still has", () => {
  const places = new Map<string, Place>([
    ["tools", { id: "a", text: "A", at: 10 }],
    ["memory-and-sessions", { id: "b", text: "B", at: 30 }],
    ["call-workflow-loop", { id: "c", text: "C", at: 20 }],
  ]);
  assert.equal(resumeTarget(new Map()), undefined);
  assert.equal(resumeTarget(places)?.slug, "memory-and-sessions");
  assert.equal(resumeTarget(places, (slug: string) => slug !== "memory-and-sessions")?.slug, "call-workflow-loop");
  assert.equal(
    resumeTarget(places, () => false),
    undefined,
  );
});

test("the link goes to the heading, escaped, or to the chapter's top", () => {
  assert.equal(resumeHref("tools", "identity-comes-first"), "/tools/#identity-comes-first");
  assert.equal(resumeHref("tools", 'a"b<c>#d'), "/tools/#a%22b%3Cc%3E%23d");
  assert.equal(resumeHref("tools", undefined), "/tools/");
});

const CHAPTER = `
  <article class="article" data-pagefind-body data-reading-chapter="tools">
    <p>Opening.</p>
    <h2 id="first-section">The first   section</h2>
    <div class="tabs"><h3 class="tabs__heading" id="lst-tool-pi-heading">pi</h3></div>
    <div class="listing"><h3 id="inside-a-listing">Not a section</h3></div>
    <div class="replay"><h2 id="inside-a-replay">Not a section</h2></div>
    <div hidden class="term-defs" data-pagefind-ignore><h3 id="glossary-text">Not a section</h3></div>
    <h3 id="a-subsection">A subsection</h3>
    <h2 id="second-section">The second section</h2>
    <h2>A heading without an id</h2>
  </article>`;

const CONTENTS = `
  <p class="resume" data-resume>
    <a class="resume__link" data-resume-link hidden>
      <span class="resume__action label">Resume reading <span data-resume-chapter></span></span><span class="visually-hidden">: </span>
      <span class="resume__where" data-resume-where></span>
    </a>
  </p>
  <nav aria-label="Contents"><ol class="contents"><li class="contents__part"><ol class="contents__chapters">
    <li class="contents__chapter"><span class="contents__number">01</span><a href="/call-workflow-loop/">Use the least autonomy</a></li>
    <li class="contents__chapter"><span class="contents__number">03</span><a href="/tools/">Tools</a></li>
  </ol></li></ol></nav>`;

let window: Window | undefined;
let requests: string[] = [];

afterEach(async () => {
  await window?.happyDOM.close();
  window = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function page(url: string, body: string, storage?: "blocked"): Window {
  requests = [];
  const win = new Window({ url });
  window = win;
  win.document.body.innerHTML = body;
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      requests.push(`${name} ${String(args[0])}`);
      throw new Error(`${name} is not allowed`);
    };
  for (const name of ["fetch", "WebSocket", "EventSource"]) {
    Object.defineProperty(win, name, { configurable: true, value: record(name) });
  }
  Object.defineProperty(win.navigator, "sendBeacon", { configurable: true, value: record("sendBeacon") });
  if (storage === "blocked") {
    // A browser with site data blocked throws a SecurityError from the localStorage getter itself.
    Object.defineProperty(win, "localStorage", {
      configurable: true,
      get() {
        throw new win.DOMException("The operation is insecure.", "SecurityError");
      },
    });
  }
  return win;
}

/** Puts each heading `offsets[id]` px below the viewport's top, as a browser would after the reader scrolled. */
function scrollTo(win: Window, offsets: Record<string, number>) {
  for (const heading of (win.document as unknown as Document).querySelectorAll("h2, h3")) {
    const top = offsets[heading.id] ?? 5000;
    heading.getBoundingClientRect = () => ({ top, bottom: top + 40, height: 40 }) as DOMRect;
  }
  win.dispatchEvent(new win.Event("scroll"));
}

const resumeLink = (win: Window) =>
  (win.document as unknown as Document).querySelector<HTMLAnchorElement>("[data-resume-link]");

const read = (win: Window) => parseStored(win.localStorage.getItem(KEY));

test("a chapter page stores the last section heading scrolled past once the scrolling settles, and none at the start", () => {
  vi.useFakeTimers();
  const win = page("https://manual.buildanagent.fyi/tools/", CHAPTER);
  const at = vi.spyOn(Date, "now").mockReturnValue(1000);
  scrollTo(win, {});
  start(win as unknown as globalThis.Window);
  assert.equal(win.localStorage.getItem(KEY), null, "the start of the chapter stores nothing");
  const write = vi.spyOn(win.localStorage, "setItem");
  scrollTo(win, { "first-section": -10, "inside-a-listing": -5, "a-subsection": 300 });
  scrollTo(win, { "first-section": -20, "inside-a-replay": -8, "glossary-text": -6, "a-subsection": 200 });
  assert.equal(write.mock.calls.length, 0, "nothing is written while the reader is still scrolling");
  vi.advanceTimersByTime(SETTLE_MS);
  assert.equal(write.mock.calls.length, 1);
  assert.deepEqual(read(win).get("tools"), { id: "first-section", text: "The first section", at: 1000 });
  at.mockReturnValue(2000);
  scrollTo(win, { "first-section": -900, "a-subsection": -400, "second-section": 0 });
  vi.advanceTimersByTime(SETTLE_MS);
  assert.deepEqual(read(win).get("tools"), { id: "second-section", text: "The second section", at: 2000 });
  scrollTo(win, { "first-section": -10, "a-subsection": 300 });
  vi.advanceTimersByTime(SETTLE_MS);
  assert.equal(read(win).get("tools")?.id, "second-section", "scrolling back up keeps the furthest place");
  assert.equal(write.mock.calls.length, 2, "a place already written is not written again");
  assert.deepEqual(requests, []);
});

test("a chapter page keeps the other chapters' places and replaces a stored id the chapter no longer has", () => {
  vi.useFakeTimers();
  const win = page("https://manual.buildanagent.fyi/tools/", CHAPTER);
  vi.spyOn(Date, "now").mockReturnValue(50);
  win.localStorage.setItem(
    KEY,
    stored({
      tools: { id: "a-removed-section", text: "Gone", at: 1 },
      "call-workflow-loop": { id: "x", text: "X", at: 2 },
    }),
  );
  scrollTo(win, { "first-section": -10 });
  start(win as unknown as globalThis.Window);
  assert.deepEqual(read(win).get("tools"), { id: "first-section", text: "The first section", at: 50 });
  assert.deepEqual(read(win).get("call-workflow-loop"), { id: "x", text: "X", at: 2 });
});

test("leaving a chapter while the scrolling settles still stores the place", () => {
  vi.useFakeTimers();
  const win = page("https://manual.buildanagent.fyi/tools/", CHAPTER);
  scrollTo(win, {});
  start(win as unknown as globalThis.Window);
  scrollTo(win, { "first-section": -10 });
  win.dispatchEvent(new win.Event("pagehide"));
  assert.equal(read(win).get("tools")?.id, "first-section");
});

test("the Contents page shows one link to the most recent chapter's heading, named by the Contents entry", () => {
  const win = page("https://manual.buildanagent.fyi/", CONTENTS);
  win.localStorage.setItem(
    KEY,
    stored({
      "call-workflow-loop": { id: "older", text: "Older", at: 1 },
      tools: { id: "a-subsection", text: "A subsection", at: 9 },
      "removed-chapter": { id: "x", text: "X", at: 99 },
    }),
  );
  start(win as unknown as globalThis.Window);
  const link = resumeLink(win);
  assert.equal(link?.hidden, false);
  assert.equal(link?.getAttribute("href"), "/tools/#a-subsection");
  assert.equal(
    link?.textContent?.replace(/\s+/g, " ").trim(),
    "Resume reading Chapter 3: A subsection",
    "a removed chapter is skipped, and the name says where the link goes",
  );
  assert.deepEqual(requests, []);
});

test("a place stored with no heading text names the chapter by its title", () => {
  const win = page("https://manual.buildanagent.fyi/", CONTENTS);
  win.localStorage.setItem(KEY, stored({ "call-workflow-loop": { id: "a", text: "", at: 1 } }));
  start(win as unknown as globalThis.Window);
  assert.equal(
    resumeLink(win)?.textContent?.replace(/\s+/g, " ").trim(),
    "Resume reading Chapter 1: Use the least autonomy",
  );
});

test("the Contents page keeps the link hidden with no place stored, with a damaged value and with storage blocked", () => {
  for (const setup of [
    () => page("https://manual.buildanagent.fyi/", CONTENTS),
    () => {
      const win = page("https://manual.buildanagent.fyi/", CONTENTS);
      win.localStorage.setItem(KEY, "{not json");
      return win;
    },
    () => page("https://manual.buildanagent.fyi/", CONTENTS, "blocked"),
  ]) {
    const win = setup();
    assert.doesNotThrow(() => start(win as unknown as globalThis.Window));
    const link = resumeLink(win);
    assert.equal(link?.hidden, true);
    assert.equal(link?.hasAttribute("href"), false, "a hidden link has no address to reach from the keyboard");
  }
});

test("a chapter page reads as usual when storage throws on every call", () => {
  vi.useFakeTimers();
  const win = page("https://manual.buildanagent.fyi/tools/", CHAPTER);
  vi.spyOn(win.localStorage, "getItem").mockImplementation(() => {
    throw new win.DOMException("blocked", "SecurityError");
  });
  vi.spyOn(win.localStorage, "setItem").mockImplementation(() => {
    throw new win.DOMException("full", "QuotaExceededError");
  });
  scrollTo(win, {});
  assert.doesNotThrow(() => start(win as unknown as globalThis.Window));
  scrollTo(win, { "first-section": -10 });
  assert.doesNotThrow(() => vi.advanceTimersByTime(SETTLE_MS));
  const blocked = page("https://manual.buildanagent.fyi/tools/", CHAPTER, "blocked");
  assert.doesNotThrow(() => start(blocked as unknown as globalThis.Window));
});

test("the script names no API that can reach the network and writes no markup from storage", () => {
  const source = readFileSync(new URL("../public/scripts/reading.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\(|new Image|\.src\s*=|navigator\.|document\.cookie/,
  );
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
