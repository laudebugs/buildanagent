// The reader's place in each chapter. On a chapter page this script records the furthest section heading the reader
// has scrolled past; on the Contents page it shows a "Resume reading" link to the chapter read most recently. The
// place stays in this browser's localStorage, so nothing leaves the browser and no request carries it. Every storage
// call sits in try/catch, so with storage blocked the chapter reads as usual and the link stays hidden. Without
// JavaScript the link stays hidden too. The file is served as-is from public/, not bundled, like theme.js; the page
// loads it as a module, which runs once the document is parsed, and the tests import its exported functions.

/** The localStorage key that holds every chapter's place. */
export const KEY = "manual-reading";

/** How long a reader's scrolling must pause before the script reads the page and writes the place, in milliseconds. */
export const SETTLE_MS = 400;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CHAPTERS = 100;
const MAX_ID = 200;
const MAX_TEXT = 300;
// Headings inside these blocks name a tab, a listing, a replay or a figure, or sit in hidden glossary text, so none of
// them marks a section of the chapter.
const NOT_A_SECTION = ".tabs, .listing, .replay, .figure, [data-pagefind-ignore]";

const isId = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID && !/[\s\p{Cc}]/u.test(value);

/** @typedef {{ id: string, text: string, at: number }} Place */

/**
 * Reads the stored value into a map from chapter slug to its place, `{ id, text, at }`. Anything that is not the
 * shape this script writes, a damaged or hand-edited value included, gives an empty map or drops that one entry.
 * @param {unknown} raw
 * @returns {Map<string, Place>}
 */
export function parseStored(raw) {
  const places = new Map();
  if (typeof raw !== "string") return places;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return places;
  }
  const chapters = value?.v === 1 ? value.chapters : undefined;
  if (typeof chapters !== "object" || chapters === null || Array.isArray(chapters)) return places;
  for (const [slug, place] of Object.entries(chapters)) {
    if (places.size >= MAX_CHAPTERS) break;
    if (!SLUG.test(slug) || typeof place !== "object" || place === null) continue;
    const { id, text, at } = place;
    if (!isId(id) || typeof text !== "string" || !Number.isFinite(at)) continue;
    places.set(slug, { id, text: text.slice(0, MAX_TEXT), at });
  }
  return places;
}

/**
 * Writes the map back as the JSON string `parseStored` reads.
 * @param {Map<string, Place>} places
 * @returns {string}
 */
export function serializeStored(places) {
  const chapters = {};
  for (const [slug, place] of places) chapters[slug] = place;
  return JSON.stringify({ v: 1, chapters });
}

/**
 * Picks the heading the reader has reached: the last one whose top has scrolled to or above the top of the viewport.
 * `tops` are the headings' distances from the viewport's top, in document order. Gives -1 when the reader is still
 * above the first heading, at the start of the chapter.
 * @param {readonly number[]} tops
 * @param {number} [line]
 * @returns {number}
 */
export function passedIndex(tops, line = 1) {
  let reached = -1;
  tops.forEach((top, index) => {
    if (top <= line) reached = index;
  });
  return reached;
}

/**
 * Picks the furthest of the stored heading and the heading reached now, by their places in `ids`, the chapter's
 * section headings in order. A stored id the chapter no longer has counts as the start, so the reached heading
 * replaces it.
 * @param {readonly string[]} ids
 * @param {string | undefined} storedId
 * @param {number} reachedIndex
 * @returns {string | undefined}
 */
export function furthestId(ids, storedId, reachedIndex) {
  const stored = storedId === undefined ? -1 : ids.indexOf(storedId);
  const index = Math.max(stored, reachedIndex);
  return index < 0 ? undefined : ids[index];
}

/**
 * Picks the place to resume: the chapter written most recently, if `has(slug)` says the book still has it.
 * @param {Map<string, Place>} places
 * @param {(slug: string) => boolean} [has]
 * @returns {(Place & { slug: string }) | undefined}
 */
export function resumeTarget(places, has = (_slug) => true) {
  let target;
  for (const [slug, place] of places) {
    if (has(slug) && (target === undefined || place.at > target.at)) target = { slug, ...place };
  }
  return target;
}

/**
 * Builds the link's address. A stored id the chapter no longer has still lands on the chapter, at its top, because a
 * browser that finds no element for a fragment leaves the page where it opened.
 * @param {string} slug
 * @param {string | undefined} id
 * @returns {string}
 */
export function resumeHref(slug, id) {
  return id === undefined ? `/${slug}/` : `/${slug}/#${encodeURIComponent(id)}`;
}

function readPlaces(storage) {
  try {
    return parseStored(storage.getItem(KEY));
  } catch {
    return new Map();
  }
}

function writePlaces(storage, places) {
  try {
    storage.setItem(KEY, serializeStored(places));
  } catch {
    // Storage can be off or full; the place is then not kept.
  }
}

function sectionHeadings(article) {
  return [...article.querySelectorAll("h2[id], h3[id]")].filter(
    (heading) => !heading.id.startsWith("lst-") && heading.closest(NOT_A_SECTION) === null,
  );
}

function trackChapter(win, storage, article, slug) {
  const headings = sectionHeadings(article);
  if (headings.length === 0) return;
  const ids = headings.map((heading) => heading.id);
  let timer;
  let written;
  const record = () => {
    clearTimeout(timer);
    timer = undefined;
    const reached = passedIndex(headings.map((heading) => heading.getBoundingClientRect().top));
    if (reached < 0) return;
    const places = readPlaces(storage);
    const id = furthestId(ids, places.get(slug)?.id, reached);
    // Write once per visit, so this chapter becomes the one to resume, and again each time the reader gets further.
    if (id === undefined || id === written) return;
    const text = (headings[ids.indexOf(id)]?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
    places.set(slug, { id, text, at: Date.now() });
    writePlaces(storage, places);
    written = id;
  };
  // A scroll only restarts the timer; the page is read and stored once the scrolling has paused.
  win.addEventListener(
    "scroll",
    () => {
      clearTimeout(timer);
      timer = setTimeout(record, SETTLE_MS);
    },
    { passive: true },
  );
  // A reader who leaves mid-pause still keeps the place.
  win.addEventListener("pagehide", () => {
    if (timer !== undefined) record();
  });
  record();
}

function showResume(doc, storage, slot) {
  const link = slot.querySelector("[data-resume-link]");
  const where = slot.querySelector("[data-resume-where]");
  if (!link || !where) return;
  // The chapter's number and title come from the Contents list itself, so a removed chapter shows no link.
  const entry = (slug) => doc.querySelector(`.contents a[href="/${slug}/"]`);
  const target = resumeTarget(readPlaces(storage), (slug) => entry(slug) !== null);
  if (!target) return;
  const anchor = entry(target.slug);
  const number = anchor?.closest(".contents__chapter")?.querySelector(".contents__number")?.textContent?.trim();
  const title = anchor?.textContent?.trim() ?? "";
  const chapter = number ? `Chapter ${Number(number)}, ${title}` : title;
  where.textContent = target.text ? `${chapter}: ${target.text}` : chapter;
  link.href = resumeHref(target.slug, target.id);
  link.hidden = false;
}

/**
 * Starts the script on a page: records the place on a chapter page and shows the link on the Contents page.
 * @param {Window} win
 */
export function start(win) {
  const doc = win.document;
  let storage;
  try {
    storage = win.localStorage;
  } catch {
    return;
  }
  if (!storage) return;
  const article = doc.querySelector("article[data-reading-chapter]");
  const slug = article?.getAttribute("data-reading-chapter") ?? "";
  if (article && SLUG.test(slug)) trackChapter(win, storage, article, slug);
  const slot = doc.querySelector("[data-resume]");
  if (slot) showResume(doc, storage, slot);
}

if (typeof window !== "undefined" && typeof document !== "undefined") start(window);
