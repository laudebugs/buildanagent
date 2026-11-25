// The header the site shows on every page: the wordmark, the mark and the four links, read from the shared
// `@buildanagent/manual/site-chrome` source so the site, the docs and the manual stay in step.
import { SITE_CHROME, siteChromeLinks } from "@buildanagent/manual/site-chrome";

/** The name beside the mark. */
export const wordmark = SITE_CHROME.sites.site.name;

/** The links of the header, in order, with Site marked current. */
export const navLinks = siteChromeLinks("site", { selfHref: "/" });

/** The repository URL shared across the header and footer. */
export const repository = SITE_CHROME.repository;

/** The inline prompt mark SVG from the shared header source. */
export const logoMark = SITE_CHROME.mark.svg;
