// The links the header shows to the other buildanagent sites, in the order apps/site's header shows them: Docs, Manual,
// Site, GitHub. They are hard-coded here because the docs, the site and the manual each keep their own copy until the
// shared header source replaces this module (todo L12p). Keep the labels and the order in step with
// apps/site/src/landing/copy.ts until then. GitHub stays in `social` in astro.config.mjs, so it keeps its icon.

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
