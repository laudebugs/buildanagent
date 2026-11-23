/**
 * Which docs pages have a Markdown twin. This is the one decision that every part of the twin feature reads: the
 * post-build step that writes the twins (through `twinPages()`), `llms.txt`, `llms-full.txt`, the
 * `<link rel="alternate">` in a page's head and the "Copy as Markdown" button. A page `hasTwin` rejects gets none of
 * them, so the five can never disagree. The module imports nothing, so the components that render each page can use it.
 *
 * Every page has a twin, the generated API reference included. TypeDoc writes the reference as Markdown already, so its
 * twins use the same pipeline (README: "Markdown twins" gives the measurement). To exclude a page, add its path prefix
 * to `EXCLUDED` with the reason, and say why in the README.
 */

/** The path prefixes of pages with no twin, each with the reason. Empty: every page has one. */
const EXCLUDED: readonly { readonly prefix: string; readonly reason: string }[] = [];

/** A slug without slashes at either end; `index`, which Starlight may give the home page, is the empty string. */
export function normalizeSlug(slug: string): string {
  const normal = slug.replace(/^\/+|\/+$/g, "");
  return normal === "index" ? "" : normal;
}

/** Whether the page at `slug` has a twin. The only place the answer is decided. */
export function hasTwin(slug: string): boolean {
  const key = normalizeSlug(slug);
  return !EXCLUDED.some(({ prefix }) => key === prefix || key.startsWith(`${prefix}/`));
}

/** The twin's address for a page slug: `start/install` becomes `/start/install.md` and the home page `/index.md`. */
export function twinUrl(slug: string): string {
  const key = normalizeSlug(slug);
  return key === "" ? "/index.md" : `/${key}.md`;
}

/** The address of the page's twin, or `undefined` when the page has none. */
export function twinHref(slug: string): string | undefined {
  return hasTwin(slug) ? twinUrl(slug) : undefined;
}
