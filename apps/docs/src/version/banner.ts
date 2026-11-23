/**
 * When the "Unreleased docs for main" banner shows. `docs-deploy.yml` builds main once and deploys that one build to
 * either docs.buildanagent.fyi or next.docs.buildanagent.fyi, so the build cannot know its host: the page decides in the
 * browser, from `location.hostname`, and this module is the only place that decides. The banner script bundles it, and
 * the tests call it, so the rule cannot drift between the two.
 *
 * The rule is "the hostname begins with `next.`", as the plan's versioning design says. It is not the exact name
 * `next.docs.buildanagent.fyi`, so a developer can see the banner by opening `next.localhost`, which browsers resolve to
 * the loopback address. A host that merely starts with the letters, such as `nextdocs.example`, does not match.
 */

/** The label of the first part of a host that marks a page as the docs for main. */
export const NEXT_PREFIX = "next.";

/** Where the stable docs are, which the banner's link and the footer's link name. */
export const STABLE_DOCS_URL = "https://docs.buildanagent.fyi/";

/** Whether a page served from `hostname` shows the banner. Case and one trailing dot (a fully qualified name) are ignored. */
export function showsUnreleasedBanner(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host.startsWith(NEXT_PREFIX) && host.length > NEXT_PREFIX.length;
}

/** The part of a banner element the script touches. */
export interface Hideable {
  hidden: boolean;
}

/** Un-hides every banner when `hostname` shows the banner. Returns whether it did. Nothing changes on any other host. */
export function revealUnreleasedBanner(banners: Iterable<Hideable>, hostname: string): boolean {
  if (!showsUnreleasedBanner(hostname)) return false;
  for (const banner of banners) banner.hidden = false;
  return true;
}
