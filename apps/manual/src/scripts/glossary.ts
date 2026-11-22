// A glossary term's card opens on hover and on focus through CSS alone. This script adds two things CSS cannot. First,
// Escape closes an open card, whether focus or the pointer opened it, without moving focus, as WCAG 1.4.13 asks of
// content shown on hover or focus; the card reopens once the pointer or focus leaves the term and comes back. Second,
// an opening card is placed at fixed coordinates inside the viewport: above its term, or below it when the term is
// near the top, and shifted left when the term is near the right edge. A narrow screen therefore never scrolls
// sideways, and a card inside a scrolling table is not clipped by it.
//
// A chapter links a term once per paragraph, so a page can hold many cards for one term. Each card sits inside its own
// .glossary-term and is placed from that term's position, so it opens at the term the reader points at. The listeners
// are added once per page.

const terms = [...document.querySelectorAll<HTMLElement>(".glossary-term")];

/** The space a card keeps from the viewport's edges, in pixels. */
const MARGIN = 8;

/** The gap between a term and its card, the 0.4rem the stylesheet gives the card without this script. */
const gap = (): number => 0.4 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

/** Returns a card to the stylesheet's own place above its term, so no stale coordinates outlive the card's opening. */
function unplace(term: HTMLElement): void {
  const card = term.querySelector<HTMLElement>(".glossary-term__card");
  card?.style.removeProperty("--card-x");
  card?.style.removeProperty("--card-y");
  delete term.dataset.placed;
  delete term.dataset.below;
}

/** Places an open card from its term's first line box, the line the reader points at. */
function place(term: HTMLElement): void {
  const card = term.querySelector<HTMLElement>(".glossary-term__card");
  const link = term.querySelector<HTMLElement>(".glossary-term__link");
  const size = card?.getBoundingClientRect();
  const line = link?.getClientRects()[0];
  // A closed or dismissed card has no size to place it by.
  if (!card || !size || size.width === 0 || !line) {
    unplace(term);
    return;
  }
  const { width, height } = size;
  const right = document.documentElement.clientWidth - MARGIN;
  const x = Math.max(MARGIN, Math.min(line.left, right - width));
  const above = line.top - gap() - height;
  const below = above < MARGIN;
  // CSSOM writes, which the page's content security policy allows: it blocks style attributes in markup, not these.
  card.style.setProperty("--card-x", `${x}px`);
  card.style.setProperty("--card-y", `${below ? line.bottom + gap() : above}px`);
  term.dataset.placed = "";
  if (below) term.dataset.below = "";
  else delete term.dataset.below;
}

/** Places every open card again, after the page or a table scrolls or the window resizes. */
function placeOpen(): void {
  for (const term of terms) {
    if (term.matches(":hover, :focus-within")) place(term);
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const term of terms) {
    if (term.matches(":hover, :focus-within")) term.dataset.dismissed = "";
  }
});

if (terms.length > 0) {
  // Captured, so a table that scrolls inside the page moves its open card too.
  document.addEventListener("scroll", placeOpen, { capture: true, passive: true });
  window.addEventListener("resize", placeOpen, { passive: true });
}

for (const term of terms) {
  term.addEventListener("pointerenter", () => place(term));
  term.addEventListener("focusin", () => place(term));
  // A card that focus still holds open keeps its place when the pointer leaves, and the other way round.
  const close = (): void => {
    delete term.dataset.dismissed;
    if (!term.matches(":hover, :focus-within")) unplace(term);
  };
  term.addEventListener("pointerleave", close);
  term.addEventListener("focusout", close);
}

// A module, so its names stay out of the global scope the other page scripts share.
export {};
