import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, beforeEach, test, vi } from "vitest";
import { loadBook } from "../src/book/load.js";
import { fixtureInputs, mutatedFixture, removeFixture, renderLikeAstro, withInteractive } from "./book-fixture.js";

// The tabs and replay scripts run here on the fixture chapter's own HTML, in a happy-dom window whose document, events
// and CSS helpers stand in for the browser's globals. Every way a script could reach the network is replaced by a spy
// that records the attempt, so stepping through a replay and switching tabs must leave the list of requests empty.

const dir = mutatedFixture(withInteractive);
const chapter = await renderLikeAstro(loadBook(fixtureInputs(dir)), "second");
removeFixture(dir);

let requests: string[] = [];
let window: Window;
let document: Document;

beforeEach(() => {
  requests = [];
  vi.resetModules();
  vi.useFakeTimers();
  window = new Window({ url: "https://manual.buildanagent.fyi/second/" });
  document = window.document as unknown as Document;
  for (const name of ["document", "window", "CSS", "HTMLElement", "Element", "KeyboardEvent", "XMLHttpRequest"]) {
    vi.stubGlobal(name, window[name as keyof Window]);
  }
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      requests.push(`${name} ${String(args[0])}`);
      throw new Error(`${name} is not allowed`);
    };
  vi.stubGlobal("fetch", record("fetch"));
  vi.stubGlobal("WebSocket", record("WebSocket"));
  vi.stubGlobal("EventSource", record("EventSource"));
  for (const name of ["fetch", "WebSocket", "EventSource"]) {
    Object.defineProperty(window, name, { configurable: true, value: record(name) });
  }
  vi.spyOn(window.XMLHttpRequest.prototype, "open").mockImplementation(record("XMLHttpRequest"));
  Object.defineProperty(window.navigator, "sendBeacon", { configurable: true, value: record("sendBeacon") });
  document.body.innerHTML = `<article>${chapter}</article>`;
  // An element the scripts add that loads something (an image, a script, a frame, a stylesheet) is a request too.
  const Observer = window.MutationObserver as unknown as typeof MutationObserver;
  new Observer((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (
          node instanceof (window.Element as unknown as typeof Element) &&
          (node.hasAttribute("src") || node.matches("link[href]"))
        ) {
          requests.push(`element ${node.outerHTML}`);
        }
      }
      if (change.type === "attributes" && ["src", "srcset", "href"].includes(change.attributeName ?? "")) {
        requests.push(`attribute ${change.attributeName}`);
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true });
});

afterEach(async () => {
  await window.happyDOM.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)?.click();
const replay = () => document.querySelector<HTMLElement>("#lst-noted-replay");
const visible = () => [...(replay()?.querySelectorAll(".replay__event:not([data-future])") ?? [])].length;
const currentLines = () =>
  [...document.querySelectorAll<HTMLElement>("#lst-noted .line[data-current-line]")].map((line) => line.dataset.line);

test("the replay steps forward and back, marks the listing line of each event and makes no request", async () => {
  await import("../src/scripts/steps.js");
  await vi.runAllTimersAsync();
  const controls = replay()?.querySelector<HTMLElement>("[data-step-controls]");
  assert.equal(controls?.hidden, false, "the script shows the controls");
  assert.equal(visible(), 1);
  assert.deepEqual(currentLines(), ["6"]);
  for (let step = 0; step < 4; step++) click("#lst-noted-replay [data-step-action='next']");
  assert.equal(visible(), 5);
  assert.deepEqual(currentLines(), [], "the model's answer names no line, so no line is marked");
  click("#lst-noted-replay [data-step-action='next']");
  assert.deepEqual(currentLines(), ["7"], "the first check came from line 7");
  click("#lst-noted-replay [data-step-action='next']");
  assert.equal(visible(), 7);
  assert.deepEqual(currentLines(), [], "line 2 is outside the listing, so no line is marked");
  assert.equal(replay()?.querySelector("[data-step-status]")?.textContent, "Event 7 of 7");
  click("#lst-noted-replay [data-step-action='back']");
  assert.equal(visible(), 6);
  assert.deepEqual(currentLines(), ["7"]);
  click("#lst-noted-replay [data-step-action='restart']");
  click("#lst-noted-replay [data-step-action='play']");
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(visible(), 7, "play steps to the end");
  assert.deepEqual(requests, []);
});

test("the replay scrolls its current event into view inside its panel, never the page, instantly under reduced motion", async () => {
  const scroller = replay()?.querySelector<HTMLElement>("[data-step-scroll]");
  assert.ok(scroller, "the events sit in a scrolling region");
  // happy-dom lays nothing out, so the region and its events report a 100 px window over 60 px rows.
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 420 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100 }) as DOMRect;
  for (const item of scroller.querySelectorAll<HTMLElement>("[data-step]")) {
    const top = Number(item.dataset.step) * 60 - scroller.scrollTop;
    item.getBoundingClientRect = () => ({ top, bottom: top + 50, height: 50 }) as DOMRect;
  }
  const scrolls: ScrollToOptions[] = [];
  scroller.scrollTo = ((options: ScrollToOptions) => scrolls.push(options)) as typeof scroller.scrollTo;
  const pageScroll = vi.spyOn(window, "scrollTo");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }),
  });
  await import("../src/scripts/steps.js");
  assert.deepEqual(scrolls, [], "the first event is already in view");
  click("#lst-noted-replay [data-step-action='next']");
  assert.deepEqual(scrolls, [{ top: 10, behavior: "auto" }], "the second event ends 10 px below the window");
  for (let step = 0; step < 2; step++) click("#lst-noted-replay [data-step-action='next']");
  assert.deepEqual(
    scrolls.at(-1),
    { top: 130, behavior: "auto" },
    "the fourth event's bottom, 230 px, meets the window's",
  );
  assert.equal(pageScroll.mock.calls.length, 0, "the page itself never scrolls");
  assert.deepEqual(requests, []);
});

test("the tabs show one listing at a time, switch from the keyboard and make no request", async () => {
  await import("../src/scripts/tabs.js");
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tabs [role='tab']")];
  assert.deepEqual(
    tabs.map((tab) => tab.textContent),
    ["demo-sdk", "other-sdk"],
  );
  const panels = [...document.querySelectorAll<HTMLElement>(".tabs__panel")];
  assert.deepEqual(
    panels.map((panel) => panel.hidden),
    [false, true],
  );
  tabs[0]?.dispatchEvent(
    new (window.KeyboardEvent as unknown as typeof KeyboardEvent)("keydown", { key: "ArrowRight", bubbles: true }),
  );
  assert.deepEqual(
    panels.map((panel) => panel.hidden),
    [true, false],
  );
  assert.equal(tabs[1]?.getAttribute("aria-selected"), "true");
  assert.deepEqual(requests, []);
});

test("neither script names an API that can reach the network", () => {
  for (const name of ["steps", "tabs"]) {
    const source = readFileSync(new URL(`../src/scripts/${name}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\(|new Image|\.src\s*=|navigator\./,
      `${name}.ts`,
    );
  }
});
