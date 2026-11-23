import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { afterEach, beforeEach, test, vi } from "vitest";
import { loadBook } from "../src/book/load.js";
import { fixtureInputs, renderLikeAstro } from "./book-fixture.js";

// scripts/glossary.ts runs here on the fixture chapter's own term links, in a happy-dom window. happy-dom lays nothing
// out, so each test gives the card and the link the boxes a browser would measure.

const chapter = await renderLikeAstro(loadBook(fixtureInputs()), "first");

let window: Window;
let document: Document;

beforeEach(async () => {
  vi.resetModules();
  window = new Window({ url: "https://manual.buildanagent.fyi/first/", width: 1280, height: 800 });
  document = window.document as unknown as Document;
  for (const name of ["document", "window", "getComputedStyle", "HTMLElement", "KeyboardEvent"]) {
    vi.stubGlobal(name, window[name as keyof Window]);
  }
  document.body.innerHTML = `<article>${chapter}</article>`;
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1280 });
  await import("../src/scripts/glossary.js");
});

afterEach(async () => {
  await window.happyDOM.close();
  vi.unstubAllGlobals();
});

/** The first term on the page, with a card of `width` px and its link's first line at (left, top). */
function term(width: number, left = 500, top = 400): { term: HTMLElement; card: HTMLElement } {
  const node = document.querySelector<HTMLElement>(".glossary-term");
  const card = node?.querySelector<HTMLElement>(".glossary-term__card");
  const link = node?.querySelector<HTMLElement>(".glossary-term__link");
  assert.ok(node && card && link, "the fixture chapter links a term");
  card.getBoundingClientRect = () => ({ width, height: width === 0 ? 0 : 120 }) as DOMRect;
  link.getClientRects = () => [{ left, top, bottom: top + 24 }] as unknown as DOMRectList;
  return { term: node, card };
}

const enter = (node: HTMLElement) => node.dispatchEvent(new window.PointerEvent("pointerenter") as unknown as Event);
const leave = (node: HTMLElement) => node.dispatchEvent(new window.PointerEvent("pointerleave") as unknown as Event);

test("an opening card is placed above its term, inside the viewport", () => {
  const { term: node, card } = term(320, 1100);
  enter(node);
  assert.equal(node.dataset.placed, "");
  assert.equal(card.style.getPropertyValue("--card-x"), `${1280 - 8 - 320}px`, "shifted left to fit");
  assert.ok(Number.parseFloat(card.style.getPropertyValue("--card-y")) < 400, "above the term");
  assert.equal(node.dataset.below, undefined);
});

test("a card near the top of the viewport opens below its term", () => {
  const { term: node, card } = term(320, 100, 20);
  enter(node);
  assert.equal(node.dataset.below, "");
  assert.ok(Number.parseFloat(card.style.getPropertyValue("--card-y")) > 20);
});

test("a card never opens under the sticky header: its room above is counted from the header's bottom edge", () => {
  const header = document.createElement("header");
  header.setAttribute("data-site-header", "");
  header.getBoundingClientRect = () => ({ bottom: 56 }) as DOMRect;
  document.body.prepend(header);
  // 180 - gap - 120 leaves about 54px above the term: room in the window, but under the 56px header and its margin.
  const { term: node, card } = term(320, 100, 180);
  enter(node);
  assert.equal(node.dataset.below, "");
  assert.ok(Number.parseFloat(card.style.getPropertyValue("--card-y")) > 180);
});

test("leaving a term clears its card's place, so the next opening never starts from stale coordinates", () => {
  const { term: node, card } = term(320);
  enter(node);
  assert.equal(node.dataset.placed, "");
  leave(node);
  assert.equal(node.dataset.placed, undefined);
  assert.equal(card.style.getPropertyValue("--card-x"), "");
  assert.equal(card.style.getPropertyValue("--card-y"), "");
});

test("a card with no size to place it by, such as a dismissed one, keeps no earlier place", () => {
  const { term: node, card } = term(320);
  enter(node);
  card.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
  enter(node);
  assert.equal(node.dataset.placed, undefined);
  assert.equal(node.dataset.below, undefined);
  assert.equal(card.style.getPropertyValue("--card-x"), "");
});
