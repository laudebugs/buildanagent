// The links the header shows to the other buildanagent sites, in the order apps/site's header shows them: Docs, Manual,
// Site, GitHub. They are hard-coded here because the docs, the site and the manual each keep their own copy until the
// shared header source replaces this module (todo L12p). Keep the labels and the order in step with
// apps/site/src/landing/copy.ts until then. GitHub stays in `social` in astro.config.mjs, so it keeps its icon.

import { installRuleFor } from "./version/install-lines.js";

/** A link to a buildanagent site. */
export interface ChromeLink {
  readonly label: string;
  readonly href: string;
  /** True for the site the reader is on, which the header marks with `aria-current`. */
  readonly current?: boolean;
}

/** The three site links before GitHub, in header order. */
export const siteLinks: readonly ChromeLink[] = [
  { label: "Docs", href: "https://docs.buildanagent.fyi", current: true },
  { label: "Manual", href: "https://manual.buildanagent.fyi" },
  { label: "Site", href: "https://buildanagent.fyi" },
];

/** The docs for the code on `main`, which the footer links to in place of a version switcher. */
export const mainDocsLink: ChromeLink = { label: "Docs for main", href: "https://next.docs.buildanagent.fyi/" };

/**
 * The "Docs for main" link the footer shows for an SDK `version`, or `undefined` when it shows none. next.docs has no
 * deploy until the first stable release, so before it docs.buildanagent.fyi serves main itself and a link there would
 * be dead. The link therefore appears once the install rule is the stable one, the switch the owner defined. A
 * prerelease other than `-alpha.` throws, as `installRuleFor` does.
 */
export function mainDocsLinkFor(version: string): ChromeLink | undefined {
  return installRuleFor(version) === "stable" ? mainDocsLink : undefined;
}
