// The header the site shows on every page: the wordmark, the mark and the four links. L12p replaces this module with the
// shared header source that the docs and the manual also use.
import { copy } from "./copy.js";

/** The name beside the mark. */
export const wordmark = copy.brand;

/** The links of the header, in order. */
export const navLinks = copy.nav;

/** The repository's address, which the licence line links to. */
export const repository = copy.nav.find((link) => link.label === "GitHub")?.href ?? "";

/**
 * The prompt mark: a rounded window, a chevron and a caret. The window and chevron take the text colour, and the caret
 * takes the accent token, so the mark follows light and dark. It is decorative, because the wordmark names the site.
 */
export const logoMark = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect x="7" y="7" width="50" height="50" rx="11" fill="none" stroke="currentColor" stroke-width="5"/><path d="M21 23L34 32L21 41" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 43H48" fill="none" stroke="var(--color-accent)" stroke-width="5" stroke-linecap="round"/></svg>`;
