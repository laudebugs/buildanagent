/**
 * The pages that have a Markdown twin, read from the content folder, for the post-build step. `hasTwin` in rule.ts is
 * the one rule for which pages may have one, and the head link and the button read it too, without a filesystem,
 * because the components render inside a bundle that has no content folder beside it. This module adds only what the
 * folder shows: a draft has no built page, so it has no twin.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { API_PACKAGES } from "../api/packages.js";
import { hasTwin, normalizeSlug, twinUrl } from "./rule.js";

/** The folder that holds every docs page, and the folders TypeDoc fills during a build. */
export const CONTENT_DIR = fileURLToPath(new URL("../content/docs/", import.meta.url));

/** One page that has a Markdown twin. */
export interface TwinPage {
  /** The page's address without slashes at either end, such as `start/install`; the home page's is the empty string. */
  readonly slug: string;
  /** Where the twin is served from, beside the page: `/start/install.md`, and `/index.md` for the home page. */
  readonly url: string;
  /** The page's source file. */
  readonly source: string;
  /** The source's path under the content folder, such as `start/install.mdx`, which error messages name. */
  readonly file: string;
  /** Whether the source is MDX, which the twin step parses with MDX syntax. */
  readonly mdx: boolean;
  /** Whether TypeDoc wrote the page during this build. */
  readonly generated: boolean;
  readonly title: string;
  readonly description: string | undefined;
}

/**
 * The slug Starlight gives a file, from its path under the content folder. Each folder and file name is slugged as
 * github-slugger does, because Astro's content loader slugs the path that way: lower case, everything but letters,
 * digits, marks, `-`, `_` and spaces dropped, then each space made a `-`. So `guides/My Page.md` is `guides/my-page`
 * and `@buildanagent/sdk/Foo.md` is `buildanagent/sdk/foo`. A file named `index` is its folder's page. A page's `slug`
 * front matter replaces the whole result, as it does in Astro. The build step's check fails when this disagrees with
 * the built site.
 */
export function slugOf(relativePath: string, override?: unknown): string {
  if (typeof override === "string" && override.trim() !== "") return normalizeSlug(override.trim());
  const parts = relativePath
    .replace(/\.mdx?$/, "")
    .split(/[\\/]/)
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "")
        .replace(/ /g, "-"),
    );
  if (parts.at(-1) === "index") parts.pop();
  return parts.join("/");
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return /\.mdx?$/.test(entry.name) ? [path] : [];
    })
    .sort();
}

/**
 * The front matter of a page's text, the text after it and the number of lines the front matter took, so a line of the
 * body plus `lines` is the line in the file.
 */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string; lines: number } {
  // The closing fence is a line of exactly `---`, so `----` in a body line never closes the block. A file may use CRLF,
  // end at the closing fence, or hold an empty block.
  const match = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (match === null) return { data: {}, body: text, lines: 0 };
  const yaml = (match[1] ?? "").replace(/\r/g, "");
  // The last fence line counts even when the file ends there with no newline.
  const lines = match[0].split("\n").length - (match[0].endsWith("\n") ? 1 : 0);
  return { data: (parse(yaml) ?? {}) as Record<string, unknown>, body: text.slice(match[0].length), lines };
}

/**
 * The pages with a twin in `contentDir`, sorted by slug. A page marked `draft: true` is left out, because Starlight
 * leaves drafts out of a production build, so a twin for one would have no page. `generatedDirs` are the folders
 * TypeDoc fills.
 */
export function readPages(contentDir: string, generatedDirs: readonly string[]): TwinPage[] {
  const pages = markdownFiles(contentDir).flatMap((source): TwinPage[] => {
    const { data } = splitFrontmatter(readFileSync(source, "utf8"));
    if (data.draft === true) return [];
    const slug = slugOf(relative(contentDir, source), data.slug);
    if (!hasTwin(slug)) return [];
    const description = typeof data.description === "string" ? data.description : undefined;
    return [
      {
        slug,
        url: twinUrl(slug),
        source,
        file: relative(contentDir, source),
        mdx: source.endsWith(".mdx"),
        generated: generatedDirs.some((dir) => source.startsWith(dir)),
        title: typeof data.title === "string" ? data.title : slug,
        description,
      },
    ];
  });
  return pages.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

let cached: readonly TwinPage[] | undefined;

/**
 * Every page with a twin, sorted by slug. The list is read once per process, so a generator that writes pages during
 * the build must have finished first; TypeDoc writes the API reference while the config loads, before any page renders.
 * Pass `fresh` to read the folder again, as tests do.
 */
export function twinPages(fresh = false): readonly TwinPage[] {
  if (cached !== undefined && !fresh) return cached;
  const generated = API_PACKAGES.map((pkg) => join(CONTENT_DIR, ...pkg.output.split("/")) + sep);
  cached = readPages(CONTENT_DIR, generated);
  return cached;
}

/** A check for a link target: whether `slug` is one of `pages`, so a link to anything else gets no `.md`. */
export function twinSlugs(pages: readonly { readonly slug: string }[]): (slug: string) => boolean {
  const known = new Set(pages.map((page) => normalizeSlug(page.slug)));
  return (slug) => known.has(normalizeSlug(slug));
}

/** A sidebar entry as far as the twin order needs it: Starlight's user config for one item or group. */
export interface SidebarEntry {
  readonly label?: string;
  readonly slug?: string;
  readonly link?: string;
  readonly items?: readonly SidebarEntry[];
  readonly autogenerate?: { readonly directory: string };
}

/** A page and the heading it sits under in `llms.txt`. */
export interface PlacedPage {
  readonly section: string;
  readonly page: TwinPage;
}

/** The heading over the generated reference, which `llms.txt` marks optional, as llmstxt.org says to. */
export const OPTIONAL_SECTION = "Optional";
const HOME_SECTION = "Overview";
const LEFTOVER_SECTION = "More";

/** The slug of an internal sidebar link such as `/reference/packages/#top`, or `undefined` for an outside address. */
function internalSlug(link: string): string | undefined {
  if (!link.startsWith("/") || link.startsWith("//")) return undefined;
  return normalizeSlug(link.split(/[?#]/)[0] ?? "");
}

/**
 * The twin pages in reading order: the home page, then the sidebar's order, each group's label as its section, with
 * the generated reference under `Optional`, and any page the sidebar leaves out last. An `autogenerate` group lists its
 * folder's pages in slug order.
 */
export function readingOrder(pages: readonly TwinPage[], sidebar: readonly SidebarEntry[]): PlacedPage[] {
  const bySlug = new Map(pages.map((page) => [normalizeSlug(page.slug), page]));
  const placed: PlacedPage[] = [];
  const seen = new Set<string>();
  const place = (page: TwinPage | undefined, section: string): void => {
    if (page === undefined || seen.has(page.slug)) return;
    seen.add(page.slug);
    placed.push({ section: page.generated ? OPTIONAL_SECTION : section, page });
  };
  place(bySlug.get(""), HOME_SECTION);
  const walk = (entries: readonly SidebarEntry[], section: string): void => {
    for (const entry of entries) {
      const name = section === "" ? (entry.label ?? "") : section;
      if (entry.slug !== undefined) place(bySlug.get(normalizeSlug(entry.slug)), name);
      // An internal link names a page by its address, so it places that page as a slug does; an outside link names none.
      const target = entry.link === undefined ? undefined : internalSlug(entry.link);
      if (target !== undefined) place(bySlug.get(target), name);
      if (entry.autogenerate !== undefined) {
        const dir = entry.autogenerate.directory.replace(/^\/+|\/+$/g, "");
        for (const page of pages) if (page.slug === dir || page.slug.startsWith(`${dir}/`)) place(page, name);
      }
      if (entry.items !== undefined) walk(entry.items, name);
    }
  };
  walk(sidebar, "");
  for (const page of pages) place(page, LEFTOVER_SECTION);
  return placed;
}
