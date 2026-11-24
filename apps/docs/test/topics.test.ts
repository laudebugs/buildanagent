import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";
import { API_PACKAGES } from "../src/api/packages.js";
import { readPages } from "../src/plugins/pages.js";
import { builtSite } from "./built.js";

// A page embeds the links of its own topic only. These tests read the built pages and fail when a page grows past its
// budget, when a page shows another topic's links, or when a topic's first and last pages link outside it.

/** The most HTML one built page may hold, in bytes. The measurement behind it is in the umbrella todo. */
const BUDGET_BYTES = 200 * 1024; // 200 KiB, 204,800 bytes

const SDK_TOPIC = "SDK & gateway";

/** Every built HTML file's path under the build folder, with its size. */
function builtPages(): { path: string; bytes: number }[] {
  const root = builtSite();
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".html"))
    .map((name) => ({ path: name, bytes: statSync(join(root, name)).size }));
}

const html = (route: string) => readFileSync(join(builtSite(), route, "index.html"), "utf8");

/** The links inside the sidebar of a built page, without the topic tabs above them. */
function sidebarLinks(page: string): string[] {
  const pane = /<sl-sidebar-pane[\s\S]*?<\/sl-sidebar-pane>/.exec(page)?.[0] ?? "";
  // Cut at the end of the tabs' own list, and require the tabs to be in the pane, so that a layout change cannot make
  // the cut drop the first group's links instead.
  const tabsStart = pane.indexOf('<ul class="starlight-sidebar-topics');
  assert.ok(tabsStart >= 0, "the topic tabs must be inside the sidebar pane");
  const afterTabs = pane.slice(pane.indexOf("</ul>", tabsStart) + "</ul>".length);
  assert.doesNotMatch(afterTabs, /starlight-sidebar-topics/, "the slice must not hold the tabs");
  return [...afterTabs.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? "");
}

/** The tabs a page shows: every label, the labels marked current by class and the labels marked `aria-current`. */
function topicTabs(page: string): { labels: string[]; current: string[]; ariaCurrent: string[] } {
  const tabs = /<ul class="starlight-sidebar-topics[\s\S]*?<\/ul>/.exec(page)?.[0] ?? "";
  const items = [...tabs.matchAll(/<a ([^>]*)>[\s\S]*?<div[^>]*>([^<]*)<\/div><\/a>/g)].map((item) => ({
    attrs: item[1] ?? "",
    label: (item[2] ?? "").replace(/&amp;/g, "&").trim(),
  }));
  const labelsWhere = (marker: string) => items.filter((item) => item.attrs.includes(marker)).map((item) => item.label);
  return {
    labels: items.map((item) => item.label),
    current: labelsWhere("starlight-sidebar-topics-current"),
    ariaCurrent: labelsWhere('aria-current="page"'),
  };
}

describe("the page budget", () => {
  test(`keeps every built page under ${BUDGET_BYTES / 1024} KiB of HTML`, () => {
    const pages = builtPages();
    assert.ok(pages.length > 250, `expected the whole site, found ${pages.length} pages`);
    const over = pages.filter((page) => page.bytes > BUDGET_BYTES).map((page) => `${page.path}: ${page.bytes} bytes`);
    assert.deepEqual(over, []);
  });
});

describe("the topics", () => {
  test("shows every topic's tab on every sidebar page, with exactly one of them current and marked aria-current", () => {
    const pages = readPages().filter((page) => page.path !== "index.mdx");
    assert.ok(pages.length > 0);
    for (const page of pages) {
      const tabs = topicTabs(html(page.path.replace(/\.mdx?$/, "")));
      assert.deepEqual(
        tabs.labels,
        [SDK_TOPIC, ...API_PACKAGES.map((pkg) => pkg.label)],
        `${page.path} shows the wrong tabs`,
      );
      assert.equal(tabs.current.length, 1, `${page.path} must have one current topic`);
      assert.deepEqual(tabs.ariaCurrent, tabs.current, `${page.path} must mark its current tab with aria-current`);
    }
  });

  test("keeps each topic's pages out of the other topics' sidebars", () => {
    const sdkLinks = sidebarLinks(html("start/install"));
    assert.ok(sdkLinks.includes("/concepts/tools/"));
    assert.deepEqual(
      sdkLinks.filter((href) => API_PACKAGES.some((pkg) => href.startsWith(`/${pkg.output}/`))),
      [],
    );
    for (const pkg of API_PACKAGES) {
      const apiLinks = sidebarLinks(html(pkg.output));
      assert.ok(apiLinks.some((href) => href.startsWith(`/${pkg.output}/`)));
      assert.deepEqual(
        apiLinks.filter((href) => !href.startsWith(`/${pkg.output}/`) && !href.startsWith("http")),
        // Only the topic tabs, which sit before the sidebar, link elsewhere.
        [],
      );
      assert.deepEqual(topicTabs(html(pkg.output)).current, [pkg.label]);
    }
  });

  test("puts every reference page, listed in the sidebar or not, in its package's topic", () => {
    const root = builtSite();
    for (const pkg of API_PACKAGES) {
      const generated = builtPages().filter((page) => page.path.startsWith(`${pkg.output}/`));
      assert.ok(generated.length > 5, `${pkg.output} has only ${generated.length} pages`);
      for (const page of generated) {
        const current = topicTabs(readFileSync(join(root, page.path), "utf8")).current;
        assert.deepEqual(current, [pkg.label], `${page.path} is not in ${pkg.label}`);
      }
    }
  });

  test("ends the Previous and Next links at a topic's first and last page", () => {
    const first = html("start/what-the-sdk-is");
    assert.doesNotMatch(first, /rel="prev"/);
    assert.match(first, /rel="next"/);
    const last = html("reference/packages");
    assert.match(last, /rel="prev"/);
    assert.doesNotMatch(last, /rel="next"/);
    // A page in the middle links to its neighbours, and both stay inside the SDK topic.
    const middle = html("concepts/tools");
    assert.match(middle, /<a href="\/concepts\/stop-reasons\/" rel="prev"/);
    assert.match(middle, /<a href="\/concepts\/approvals\/" rel="next"/);
  });

  test("keeps a modules-sidebar package limited to entry-point links", () => {
    const modulePackages = API_PACKAGES.filter((pkg) => pkg.sidebar === "modules");
    assert.ok(modulePackages.length > 0, "expected at least one modules-sidebar package");
    for (const pkg of modulePackages) {
      const links = sidebarLinks(html(pkg.output));
      assert.ok(links.length > 0, `${pkg.name} sidebar lists its modules`);
      assert.deepEqual(
        links.filter((href) => /\/(classes|functions|interfaces|type-aliases|variables|enumerations)\//.test(href)),
        [],
        `${pkg.name} sidebar must omit leaf export pages`,
      );
    }
  });

  test("keeps the home page free of any sidebar topic", () => {
    const home = readFileSync(join(builtSite(), "index.html"), "utf8");
    assert.doesNotMatch(home, /starlight-sidebar-topics/);
  });
});
