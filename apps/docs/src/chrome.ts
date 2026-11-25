// Header links, wordmark and mark read from the shared `@buildanagent/manual/site-chrome` source so the docs,
// the manual and the landing site stay in step. GitHub stays in `social` in astro.config.mjs so it keeps its icon.

import { SITE_CHROME, siteChromeLinks } from "@buildanagent/manual/site-chrome";
import { installRuleFor } from "./version/install-lines.js";

/** A link to a buildanagent site. */
export interface ChromeLink {
  readonly label: string;
  readonly href: string;
  /** True for the site the reader is on, which the header marks with `aria-current`. */
  readonly current?: boolean;
}

/** The three site links before GitHub, in header order. */
export const siteLinks: readonly ChromeLink[] = siteChromeLinks("docs")
  .filter((link) => link.id !== "github")
  .map(({ label, href, current }) => (current ? { label, href, current } : { label, href }));

/** The GitHub repository link from the shared header source, passed to Starlight's `social` config. */
export const githubLink: ChromeLink = (() => {
  const found = SITE_CHROME.links.find((link) => link.id === "github");
  if (found === undefined) throw new Error("site-chrome is missing the github link");
  return { label: found.label, href: found.href };
})();

/** The docs wordmark from the shared header source (`Build An Agent` + `docs`). */
export const docsWordmark = SITE_CHROME.sites.docs;

/** The inline prompt mark SVG from the shared header source. */
export const logoMark = SITE_CHROME.mark.svg;

/** The docs for the code on `main`, which the footer links to in place of a version switcher. */
export const mainDocsLink: ChromeLink = { label: "Docs for main", href: "https://next.docs.buildanagent.fyi/" };

/**
 * The "Docs for main" link the footer shows for an SDK `version`, or `undefined` when it shows none. next.docs has no
 * deploy until the first stable release, so before it docs.buildanagent.fyi serves main itself and a link there would
 * be dead. The link therefore appears once the install rule is the stable one, the stable switch in DS4 of the publish plan. A
 * prerelease other than `-alpha.` throws, as `installRuleFor` does.
 */
export function mainDocsLinkFor(version: string): ChromeLink | undefined {
  return installRuleFor(version) === "stable" ? mainDocsLink : undefined;
}
