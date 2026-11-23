// The hosts on which the page registers the service worker, written into every page at build time as
// <meta name="manual-offline-hosts">. A production build lists only the host of the config's `site`, so a preview at
// pr-<n>.manual.buildanagent.fyi registers nothing. The browser check builds with MANUAL_OFFLINE_TEST_HOST set to a
// loopback name, the only other value this accepts, so no setting can add a host that serves the book to readers.

/** The loopback names a test build may add; a page on one of them is never a deployed copy of the book. */
export const TEST_HOSTS: readonly string[] = ["127.0.0.1", "localhost"];

/** Returns the hosts that register the worker: the site's host, plus a loopback test host when one is given. */
export function offlineHosts(site: URL | undefined, testHost: string | undefined): string[] {
  if (!site) throw new Error("the Astro config must set `site`, whose host is the only one that registers the worker");
  if (testHost === undefined || testHost === "") return [site.hostname];
  if (!TEST_HOSTS.includes(testHost)) {
    throw new Error(`MANUAL_OFFLINE_TEST_HOST must be one of ${TEST_HOSTS.join(", ")}, not "${testHost}"`);
  }
  return [site.hostname, testHost];
}
