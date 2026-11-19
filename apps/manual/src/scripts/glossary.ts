// A glossary term's card opens on hover and on focus through CSS alone. This script adds what CSS cannot: Escape
// closes an open card, whether focus or the pointer opened it, without moving focus, as WCAG 1.4.13 asks of content
// shown on hover or focus. The card reopens once the pointer or focus leaves the term and comes back.

const terms = [...document.querySelectorAll<HTMLElement>(".glossary-term")];

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const term of terms) {
    if (term.matches(":hover, :focus-within")) term.dataset.dismissed = "";
  }
});

for (const term of terms) {
  term.addEventListener("pointerleave", () => delete term.dataset.dismissed);
  term.addEventListener("focusout", () => delete term.dataset.dismissed);
}

// A module, so its names stay out of the global scope the other page scripts share.
export {};
