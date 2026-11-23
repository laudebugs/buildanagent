/**
 * The post-build half of the Markdown twins: writes `/<page>.md` for every page the one function names, `llms.txt` and
 * `llms-full.txt`, and checks the built site. The files are separate from the HTML, so no page grows by a byte.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { twinMarkdown } from "./flatten.js";
import { OPTIONAL_SECTION, type PlacedPage, splitFrontmatter, type TwinPage, twinSlugs } from "./pages.js";

/** What `llms.txt` says about the site. */
export interface TwinSite {
  /** The site's origin without a trailing slash, such as `https://docs.buildanagent.fyi`. */
  readonly origin: string;
  readonly title: string;
  /** One sentence that says what the site is. */
  readonly summary: string;
}

/**
 * A page's twin as text, read from its source file. `hasTwin` says which link targets are pages with a twin; the build
 * passes `twinSlugs(pages)`, so an asset or an unknown address in a link stays an address on the site.
 */
export function renderTwin(page: TwinPage, site: TwinSite, hasTwin: (slug: string) => boolean): string {
  const { body } = splitFrontmatter(readFileSync(page.source, "utf8"));
  return twinMarkdown(page, body, page.mdx, {
    site: site.origin,
    hasTwin,
    page: page.slug === "" ? "index" : page.slug,
  });
}

const absolute = (site: TwinSite, page: TwinPage) => `${site.origin}${page.url}`;

/**
 * `llms.txt` in the llmstxt.org shape: a title, a one-sentence summary and a list of links under each heading, one
 * line for each twin. The generated reference goes under `Optional`, which that format says a reader may skip.
 */
export function llmsTxt(placed: readonly PlacedPage[], site: TwinSite): string {
  const sections = new Map<string, PlacedPage[]>();
  for (const entry of placed) sections.set(entry.section, [...(sections.get(entry.section) ?? []), entry]);
  // The optional section goes last whatever the order the sidebar gave.
  const names = [...sections.keys()].sort((a, b) => Number(a === OPTIONAL_SECTION) - Number(b === OPTIONAL_SECTION));
  const lines = [`# ${site.title}`, "", `> ${site.summary}`];
  for (const name of names) {
    lines.push("", `## ${name}`, "");
    for (const { page } of sections.get(name) ?? []) {
      const description = page.description === undefined ? "" : `: ${page.description}`;
      lines.push(`- [${page.title}](${absolute(site, page)})${description}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** `llms-full.txt`: every twin in reading order, each after a line that gives its address. */
export function llmsFullTxt(placed: readonly PlacedPage[], twins: ReadonlyMap<string, string>, site: TwinSite): string {
  const parts = [`# ${site.title}\n\n> ${site.summary}\n`];
  for (const { page } of placed) parts.push(`---\n\nSource: ${absolute(site, page)}\n\n${twins.get(page.slug) ?? ""}`);
  return parts.join("\n");
}

/** What a build wrote. */
export interface TwinReport {
  readonly count: number;
  readonly bytes: number;
}

/** Writes every twin, `llms.txt` and `llms-full.txt` into `dist`. */
export function writeTwins(dist: string, placed: readonly PlacedPage[], site: TwinSite): TwinReport {
  const twins = new Map<string, string>();
  let bytes = 0;
  const hasTwin = twinSlugs(placed.map((entry) => entry.page));
  for (const { page } of placed) {
    const text = renderTwin(page, site, hasTwin);
    twins.set(page.slug, text);
    const file = join(dist, ...page.url.split("/").filter(Boolean));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    bytes += Buffer.byteLength(text);
  }
  writeFileSync(join(dist, "llms.txt"), llmsTxt(placed, site));
  writeFileSync(join(dist, "llms-full.txt"), llmsFullTxt(placed, twins, site));
  return { count: placed.length, bytes };
}

/** The file a page is built to, under the build's folder. */
export function htmlOf(dist: string, page: TwinPage): string {
  return join(dist, ...page.slug.split("/").filter(Boolean), "index.html");
}

/** The value of attribute `name` in one HTML tag, or `undefined`. */
function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/** Whether `html` has a `<link rel="alternate" type="text/markdown" href="url">` in it. */
export function hasAlternateLink(html: string, url: string): boolean {
  return (html.match(/<link\b[^>]*>/g) ?? []).some(
    (tag) => attr(tag, "rel") === "alternate" && attr(tag, "type") === "text/markdown" && attr(tag, "href") === url,
  );
}

/**
 * What is wrong with a built site, one sentence each: a page the function names whose twin file is missing or empty, whose
 * built page is missing, or whose head lacks the alternate link. An empty list means every page has both.
 */
export function checkTwins(dist: string, pages: readonly TwinPage[]): string[] {
  const problems: string[] = [];
  for (const page of pages) {
    const twin = join(dist, ...page.url.split("/").filter(Boolean));
    if (!existsSync(twin)) problems.push(`${page.url}: the twin was not written`);
    else if (readFileSync(twin, "utf8").trim() === "") problems.push(`${page.url}: the twin is empty`);
    const html = htmlOf(dist, page);
    if (!existsSync(html)) {
      problems.push(
        `${page.url}: no built page at ${html.slice(dist.length + 1)}, so the slug may differ from Starlight's`,
      );
    } else if (!hasAlternateLink(readFileSync(html, "utf8"), page.url)) {
      problems.push(
        `${page.url}: the page's head has no <link rel="alternate" type="text/markdown" href="${page.url}">`,
      );
    }
  }
  return problems;
}
