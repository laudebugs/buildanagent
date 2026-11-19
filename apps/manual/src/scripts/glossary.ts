// A glossary term's card opens on hover and on focus through CSS alone. This script adds what CSS cannot: Escape
// closes an open card without moving focus, as WCAG 1.4.13 asks of content shown on hover or focus.

for (const term of document.querySelectorAll<HTMLElement>(".glossary-term")) {
  term.addEventListener("keydown", (event) => {
    if (event.key === "Escape") term.dataset.dismissed = "";
  });
  term.addEventListener("pointerleave", () => delete term.dataset.dismissed);
  term.addEventListener("focusout", () => delete term.dataset.dismissed);
}

// A module, so its functions stay out of the global scope the other page scripts share.
export {};
