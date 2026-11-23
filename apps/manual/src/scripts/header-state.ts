// The two decisions behind the sticky header, as pure functions: whether a phone's header is hidden after a scroll, and
// how far through a chapter a reader is. They read no DOM and no clock, so a unit test can run them over a scroll
// trace. scripts/header.ts is the thin DOM wrapper that feeds them and applies their answers.

/** What the header remembers between two scroll events. */
export interface HeaderState {
  /** Whether the header is slid out of view. */
  readonly hidden: boolean;
  /** The scroll position the last direction was measured from. */
  readonly lastY: number;
}

/** What else decides whether the header may hide. */
export interface HeaderFlags {
  /** Whether the phone header is in use. A desktop header never hides. */
  readonly phone: boolean;
  /** Whether the menu is open. */
  readonly menuOpen: boolean;
  /** Whether the search field's panel is open. */
  readonly searchOpen: boolean;
  /** Whether the reading settings panel is open. */
  readonly settingsOpen: boolean;
  /** Whether a keyboard reader's focus is inside the header. */
  readonly focusInside: boolean;
  /** The header's height in pixels: the reader is "near the top" while the page is scrolled less than this. */
  readonly headerHeight: number;
}

/** The smallest scroll, in pixels, that counts as a direction. A smaller move builds up until it reaches this. */
export const SCROLL_THRESHOLD = 8;

/** The state a page starts in: shown, with no scroll to compare against. */
export function initialHeaderState(scrollY = 0): HeaderState {
  return { hidden: false, lastY: scrollY };
}

/**
 * The header's state after a scroll to `scrollY`. It hides on a downward scroll and returns on the first upward one, and
 * it stays shown on a desktop, near the top of the page, while the menu, search or reading settings are open and while
 * focus is inside it.
 * A move shorter than the threshold changes nothing and keeps its starting point, so a slow scroll still adds up.
 * A rubber-band overscroll (a negative `scrollY`) counts as the top.
 */
export function nextHeaderState(
  prev: HeaderState,
  scrollY: number,
  flags: HeaderFlags,
  threshold: number = SCROLL_THRESHOLD,
): HeaderState {
  const y = Math.max(0, scrollY);
  const pinned =
    !flags.phone ||
    flags.menuOpen ||
    flags.searchOpen ||
    flags.settingsOpen ||
    flags.focusInside ||
    y < flags.headerHeight;
  if (pinned) return { hidden: false, lastY: y };
  const delta = y - prev.lastY;
  if (Math.abs(delta) < threshold) return prev;
  return { hidden: delta > 0, lastY: y };
}

/**
 * How far through the chapter's main text a reader is, from 0 to 1. `start` and `end` are the document positions, in
 * pixels, of the top of the chapter and the end of its main text (before its sources, the previous and next links and
 * the footer). The value is 0 at the top of the chapter and 1 when the end of the main text reaches the bottom of the
 * window, and it is clamped between. A chapter that fits in the window is 0 until the reader scrolls at all, then 1, so a
 * page whose whole scroll is shorter than `start` still reaches 1 at its end.
 */
export function readingProgress(scrollY: number, start: number, end: number, viewportH: number): number {
  const span = end - viewportH - start;
  if (!(span > 0)) return scrollY > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, (scrollY - start) / span));
}
