// The sticky header's script: the phone menu, the phone search panel, the hide-on-scroll rule and the reading progress
// line. The decisions live in header-state.ts; this file reads the page, calls them and applies the answers. Without
// JavaScript the buttons this file shows stay hidden, the header stays shown, and the progress line stays empty.
//
// It has one passive scroll listener, which only asks for an animation frame; the frame reads the scroll position and
// the cached measurements, then writes one attribute and one transform. Nothing is measured while scrolling except the
// page's scroll height, which is read before the frame writes anything.

import {
  type HeaderFlags,
  type HeaderState,
  initialHeaderState,
  nextHeaderState,
  readingProgress,
} from "./header-state.js";

// The same query as the phone rules in styles/header.css; test/header-static.test.ts fails if they differ.
const PHONE = "(max-width: 760px), (pointer: coarse)";

const header = document.querySelector<HTMLElement>("[data-site-header]");
const root = document.documentElement;
const phone = window.matchMedia(PHONE);

let state: HeaderState = initialHeaderState(window.scrollY);
let headerHeight = header?.getBoundingClientRect().height ?? 0;
let frame = 0;

// The menu and the search panel, both present on every page.
const menuButton = header?.querySelector<HTMLButtonElement>("[data-menu-button]") ?? null;
const menu = header?.querySelector<HTMLElement>("[data-menu]") ?? null;
const notesEntry = header?.querySelector<HTMLButtonElement>("[data-menu-notes]") ?? null;
const searchToggle = header?.querySelector<HTMLButtonElement>("[data-search-toggle]") ?? null;
const searchPanel = header?.querySelector<HTMLElement>("[data-header-search]") ?? null;

const isOpen = (button: HTMLElement | null) => button?.getAttribute("aria-expanded") === "true";

function flags(): HeaderFlags {
  const active = document.activeElement;
  return {
    phone: phone.matches,
    menuOpen: isOpen(menuButton),
    searchOpen: isOpen(searchToggle),
    // A tap leaves focus on a button in some browsers; only focus a keyboard or a typing reader put there counts.
    focusInside: !!header && !!active && header.contains(active) && active.matches(":focus-visible"),
    headerHeight,
  };
}

function applyHeader(): void {
  frame = 0;
  const docEl = document.documentElement;
  // Past the end of the page, an iOS overscroll bounce would read as an upward scroll and bring the header back.
  const y = Math.min(window.scrollY, Math.max(0, docEl.scrollHeight - docEl.clientHeight));
  const next = nextHeaderState(state, y, flags());
  if (next.hidden !== state.hidden) root.toggleAttribute("data-header-hidden", next.hidden);
  state = next;
  if (progress) paintProgress(y);
}

function schedule(): void {
  if (!frame) frame = window.requestAnimationFrame(applyHeader);
}

// ---- The menu and the search panel ---------------------------------------------------------------------------------

function setMenu(open: boolean, refocus = false): void {
  if (!menuButton || !menu) return;
  if (open) setSearch(false);
  menuButton.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
  if (open) {
    // The Notes entry belongs to chapters: public/scripts/notes.js adds its button there and nowhere else.
    if (notesEntry) notesEntry.hidden = !document.querySelector(".notes-open");
    menu.querySelector<HTMLElement>("a, button:not([hidden])")?.focus();
  } else if (refocus) {
    menuButton.focus();
  }
  schedule();
}

function setSearch(open: boolean, refocus = false): void {
  if (!searchToggle || !searchPanel) return;
  if (open) setMenu(false);
  searchToggle.setAttribute("aria-expanded", String(open));
  searchPanel.toggleAttribute("data-open", open);
  if (open) searchPanel.querySelector<HTMLElement>("input")?.focus();
  else if (refocus) searchToggle.focus();
  schedule();
}

function closeAll(): void {
  setMenu(false);
  setSearch(false);
}

menuButton?.addEventListener("click", () => setMenu(!isOpen(menuButton)));
searchToggle?.addEventListener("click", () => setSearch(!isOpen(searchToggle)));
if (menuButton) menuButton.hidden = false;
if (searchToggle) searchToggle.hidden = false;

// A link in the menu is a navigation, so the menu closes; the page that opens starts with it closed.
menu?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("a, button") : null;
  if (!target) return;
  setMenu(false);
  if (target === notesEntry) document.querySelector<HTMLElement>(".notes-open")?.click();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (isOpen(menuButton)) setMenu(false, true);
  else if (isOpen(searchToggle)) setSearch(false, true);
});

document.addEventListener("pointerdown", (event) => {
  if (header && event.target instanceof Node && !header.contains(event.target)) closeAll();
});

// Tabbing out of the header closes whatever is open, so a panel never hangs over the page behind the reader's focus.
header?.addEventListener("focusout", (event) => {
  if (event.relatedTarget instanceof Node && !header.contains(event.relatedTarget)) closeAll();
});

// Keyboard focus moving into a hidden header brings it back.
header?.addEventListener("focusin", schedule);
window.addEventListener("pageshow", closeAll);

// ---- The reading progress line -------------------------------------------------------------------------------------

const progress = document.querySelector<HTMLElement>("[data-reading-progress]");
const bar = progress?.querySelector<HTMLElement>("[data-reading-bar]") ?? null;
const chapter = document.querySelector<HTMLElement>("[data-reading-chapter]");
let start = 0;
let end = 0;

/** The chapter's top and the end of its main text, as positions in the document; remeasured when the page's size changes. */
function measure(): void {
  headerHeight = header?.getBoundingClientRect().height ?? 0;
  if (!chapter) return;
  const top = (element: Element) => element.getBoundingClientRect().top + window.scrollY;
  const layout = chapter.closest(".layout") ?? chapter;
  const sources = chapter.querySelector(".chapter-sources");
  start = top(layout);
  end = sources ? top(sources) : top(chapter) + chapter.getBoundingClientRect().height;
}

let painted = -1;
function paintProgress(y: number): void {
  if (!bar) return;
  // Four decimals keep the line within a pixel on any screen and skip writes while the value has not changed.
  const value = Math.round(readingProgress(y, start, end, window.innerHeight) * 10000) / 10000;
  if (value === painted) return;
  painted = value;
  bar.style.transform = `scaleX(${value})`;
}

// ---- Start ---------------------------------------------------------------------------------------------------------

window.addEventListener("scroll", schedule, { passive: true });
window.addEventListener("resize", refresh);
phone.addEventListener("change", () => {
  if (!phone.matches) closeAll();
  measure();
  state = initialHeaderState(window.scrollY);
  root.removeAttribute("data-header-hidden");
  schedule();
});
/** Remeasures the chapter and the header, then paints the next frame. */
function refresh(): void {
  measure();
  schedule();
}

if (chapter && typeof ResizeObserver === "function") new ResizeObserver(refresh).observe(chapter);
window.addEventListener("load", refresh);
document.fonts?.ready.then(refresh);
refresh();
