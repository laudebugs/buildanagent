// Shared header chrome for buildanagent.fyi, docs.buildanagent.fyi and manual.buildanagent.fyi.
// The canonical data lives in ./site-chrome.json; each app renders its own markup from this module.
import raw from "./site-chrome.json" with { type: "json" };

/** One of the three buildanagent web apps. */
export type SiteId = "docs" | "manual" | "site";

/** One header link entry in canonical order. */
export type SiteChromeLinkId = SiteId | "github";

/** One link in the shared cross-site header. */
export interface SiteChromeLink {
  readonly id: SiteChromeLinkId;
  readonly label: string;
  readonly href: string;
}

/** One link resolved for a specific site, marking the active site with `current: true`. */
export interface ResolvedChromeLink extends SiteChromeLink {
  readonly current?: boolean;
}

/** A site's wordmark text: the shared brand name plus an optional mono kind label (`docs` or `manual`). */
export interface SiteWordmark {
  readonly name: string;
  readonly kind?: string;
}

/** The inline prompt mark SVG and its viewBox. */
export interface SiteMark {
  readonly viewBox: string;
  readonly svg: string;
}

/** The full shared header chrome payload. */
export interface SiteChrome {
  readonly brand: string;
  readonly repository: string;
  readonly links: readonly SiteChromeLink[];
  readonly sites: Readonly<Record<SiteId, SiteWordmark>>;
  readonly mark: SiteMark;
}

/** The canonical shared header chrome read from `site-chrome.json`. */
export const SITE_CHROME: SiteChrome = raw as SiteChrome;

/** Options for resolving header links on a specific site. */
export interface SiteChromeLinksOptions {
  /** Override the current site's href (for example `"/"` on `apps/site` or `apps/manual`). */
  readonly selfHref?: string;
}

/** Returns the four shared header links in order, marking `currentSite` with `current: true`. */
export function siteChromeLinks(
  currentSite: SiteId,
  options: SiteChromeLinksOptions = {},
): readonly ResolvedChromeLink[] {
  return SITE_CHROME.links.map((link) => {
    if (link.id !== currentSite) return { id: link.id, label: link.label, href: link.href };
    return {
      id: link.id,
      label: link.label,
      href: options.selfHref ?? link.href,
      current: true,
    };
  });
}
