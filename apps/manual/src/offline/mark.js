// A page's build mark, <meta name="manual-build" content="<id>">: how the worker (worker.ts) and the post-deploy check
// (scripts/offline-verify-deployed.mjs) find it and set it. Both import this one plain module, so they can never read a
// page's mark differently. The build writes the mark with scripts/offline-build.mjs (ADR 0059).

/** The placeholder a page's build mark holds before the build writes its id; the list hashes pages with it. */
export const BUILD_PLACEHOLDER = "__MANUAL_BUILD__";

const MARK_START = new TextEncoder().encode('<meta name="manual-build" content="');
const QUOTE = 0x22;
const MARK_VALUE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Finds a page's build mark and returns where its value starts and ends and the value, or null when the page has none.
 * Only the first occurrence of the mark's opening counts, and a value that is not 1 to 64 letters, digits or
 * underscores means the page has no mark; a page with a second mark differs from the list wherever it is.
 * @param {Uint8Array} bytes
 * @returns {{ readonly start: number, readonly end: number, readonly value: string } | null}
 */
export function findMark(bytes) {
  outer: for (let i = 0; i + MARK_START.length < bytes.length; i++) {
    for (let j = 0; j < MARK_START.length; j++) if (bytes[i + j] !== MARK_START[j]) continue outer;
    const start = i + MARK_START.length;
    const end = bytes.indexOf(QUOTE, start);
    if (end === -1 || end - start > 64) return null;
    const value = String.fromCharCode(...bytes.subarray(start, end));
    return MARK_VALUE.test(value) ? { start, end, value } : null;
  }
  return null;
}

/**
 * Returns a page's bytes with its build mark holding `value`, or the bytes unchanged when it has none.
 * @param {Uint8Array} bytes
 * @param {string} value
 * @returns {Uint8Array}
 */
export function withMark(bytes, value) {
  const mark = findMark(bytes);
  if (!mark) return bytes;
  const inserted = new TextEncoder().encode(value);
  const out = new Uint8Array(bytes.length - (mark.end - mark.start) + inserted.length);
  out.set(bytes.subarray(0, mark.start));
  out.set(inserted, mark.start);
  out.set(bytes.subarray(mark.end), mark.start + inserted.length);
  return out;
}
