import assert from "node:assert/strict";
import { test } from "vitest";
import {
  type HeaderFlags,
  type HeaderState,
  initialHeaderState,
  nextHeaderState,
  readingProgress,
  SCROLL_THRESHOLD,
} from "../src/scripts/header-state.js";

// The header's two decisions are pure, so a scroll trace is enough to test them: no browser, no timers.

const phone: HeaderFlags = {
  phone: true,
  menuOpen: false,
  searchOpen: false,
  focusInside: false,
  headerHeight: 52,
};

/** Runs a trace of scroll positions through the rule and returns whether the header was hidden after each. */
function trace(positions: readonly number[], flags: HeaderFlags = phone, from: HeaderState = initialHeaderState(0)) {
  let state = from;
  return positions.map((y) => {
    state = nextHeaderState(state, y, flags);
    return state.hidden;
  });
}

test("a phone header hides on a downward scroll and returns on the first upward one", () => {
  assert.deepEqual(trace([0, 100, 200, 300, 295, 280, 400]), [false, true, true, true, true, false, true]);
});

test("a phone header stays shown while the page is scrolled less than its height", () => {
  assert.deepEqual(trace([10, 30, 51]), [false, false, false]);
  assert.deepEqual(trace([60]), [true]);
});

test("a move shorter than the threshold changes nothing, and slow moves add up", () => {
  const down = initialHeaderState(200);
  assert.equal(nextHeaderState(down, 200 + SCROLL_THRESHOLD - 1, phone).hidden, false);
  // Three 3px steps are 9px: the third crosses the threshold, because a small step keeps its starting point.
  assert.deepEqual(trace([203, 206, 209], phone, down), [false, false, true]);
  const hidden = { hidden: true, lastY: 500 };
  assert.deepEqual(trace([498, 496, 492], phone, hidden), [true, true, false]);
});

test("a desktop header never hides", () => {
  assert.deepEqual(trace([0, 500, 1000, 400], { ...phone, phone: false }), [false, false, false, false]);
});

test("the menu, the search panel and keyboard focus keep the header shown", () => {
  for (const flag of ["menuOpen", "searchOpen", "focusInside"] as const) {
    assert.deepEqual(trace([100, 400, 900], { ...phone, [flag]: true }), [false, false, false], flag);
  }
});

test("a header shown by an open menu may hide again once the menu closes", () => {
  const open = nextHeaderState(initialHeaderState(0), 500, { ...phone, menuOpen: true });
  assert.equal(open.hidden, false);
  assert.equal(nextHeaderState(open, 600, phone).hidden, true);
});

test("an overscroll above the top counts as the top", () => {
  assert.deepEqual(nextHeaderState({ hidden: true, lastY: 300 }, -40, phone), { hidden: false, lastY: 0 });
});

test("the state is never mutated", () => {
  const before = Object.freeze({ hidden: false, lastY: 0 });
  assert.doesNotThrow(() => nextHeaderState(before, 400, phone));
});

test("reading progress is 0 at the chapter's start, 1 at its end and clamped between", () => {
  const start = 80;
  const end = 5080;
  const viewport = 800;
  const last = end - viewport;
  assert.equal(readingProgress(0, start, end, viewport), 0);
  assert.equal(readingProgress(start, start, end, viewport), 0);
  assert.equal(readingProgress(last, start, end, viewport), 1);
  assert.equal(readingProgress(last + 500, start, end, viewport), 1);
  assert.equal(readingProgress(-30, start, end, viewport), 0);
  assert.equal(readingProgress(start + (last - start) / 2, start, end, viewport), 0.5);
  assert.ok(Math.abs(readingProgress(1500, start, end, viewport) - (1500 - start) / (last - start)) < 1e-12);
});

test("reading progress rises with the scroll position", () => {
  let previous = -1;
  for (let y = 0; y <= 6000; y += 250) {
    const value = readingProgress(y, 80, 5080, 800);
    assert.ok(value >= previous, `at ${y}`);
    previous = value;
  }
});

test("a chapter that fits in the window is 0 until the reader scrolls, then 1", () => {
  assert.equal(readingProgress(0, 80, 600, 900), 0);
  assert.equal(readingProgress(1, 0, 600, 900), 1);
});

test("a short page reaches 1 at its end even when its whole scroll is shorter than the chapter's start", () => {
  // The chapter starts 56px down and the window is 40px short of showing it all.
  assert.equal(readingProgress(0, 56, 700, 900), 0);
  assert.equal(readingProgress(40, 56, 700, 900), 1);
});
