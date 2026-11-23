/**
 * The pages that have a Markdown twin, read from the content folder, for the post-build step. Whether a page has one is
 * decided by `hasTwin` in rule.ts alone, which the head link and the button read too, without a filesystem, because the
 * components render inside a bundle that has no content folder beside it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { API_PACKAGES } from "../api/packages.js";
import { hasTwin, twinUrl } from "./rule.js";

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
  /** Whether the source is MDX, which the twin step parses with MDX syntax. */
  readonly mdx: boolean;
  /** Whether TypeDoc wrote the page during this build. */
  readonly generated: boolean;
  readonly title: string;
  readonly description: string | undefined;
}

/**
 * The slug Starlight gives a file, from its path under the content folder. Each folder and file name is slugged as
 * github-slugger does (lower case, and everything but letters, digits, `-` and `_` dropped), because Astro's content
 * loader slugs the path that way, so `@buildanagent/sdk/Foo.md` is `buildanagent/sdk/foo`. A file named `index` is its
 * folder's page. The build step's check fails when this disagrees with the built site.
 */
export function slugOf(relativePath: string): string {
  const parts = relativePath
    .replace(/\.mdx?$/, "")
    .split(/[\\/]/)
    .map((part) => part.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_-]/gu, ""));
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

/** The front matter of a page's text and the text after it. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) return { data: {}, body: text };
  return { data: (parse(match[1] ?? "") ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) };
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
  const pages = markdownFiles(CONTENT_DIR).flatMap((source): TwinPage[] => {
    const slug = slugOf(relative(CONTENT_DIR, source));
    if (!hasTwin(slug)) return [];
    const { data } = splitFrontmatter(readFileSync(source, "utf8"));
    const description = typeof data.description === "string" ? data.description : undefined;
    return [
      {
        slug,
        url: twinUrl(slug),
        source,
        mdx: source.endsWith(".mdx"),
        generated: generated.some((dir) => source.startsWith(dir)),
        title: typeof data.title === "string" ? data.title : slug,
        description,
      },
    ];
  });
  cached = pages.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return cached;
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

/**
 * The twin pages in reading order: the home page, then the sidebar's order, each group's label as its section, with
 * the generated reference under `Optional`, and any page the sidebar leaves out last. An `autogenerate` group lists its
 * folder's pages in slug order.
 */
export function readingOrder(pages: readonly TwinPage[], sidebar: readonly SidebarEntry[]): PlacedPage[] {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
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
      if (entry.slug !== undefined) place(bySlug.get(entry.slug.replace(/^\/+|\/+$/g, "")), name);
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
