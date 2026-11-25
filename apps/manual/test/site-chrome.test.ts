import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { SITE_CHROME, siteChromeLinks } from "../src/design/site-chrome.js";
import { builtBook } from "./built.js";

test("site-chrome.json holds the canonical brand, repository, four links in order, three sites and prompt mark", () => {
  const raw = JSON.parse(readFileSync(new URL("../src/design/site-chrome.json", import.meta.url), "utf8")) as unknown;
  assert.deepEqual(SITE_CHROME, raw);
  assert.equal(SITE_CHROME.brand, "Build An Agent");
  assert.equal(SITE_CHROME.repository, "https://github.com/laudebugs/buildanagent");
  assert.deepEqual(
    SITE_CHROME.links.map((link) => link.id),
    ["docs", "manual", "site", "github"],
  );
  assert.deepEqual(
    SITE_CHROME.links.map((link) => link.label),
    ["Docs", "Manual", "Site", "GitHub"],
  );
  for (const link of SITE_CHROME.links) {
    assert.match(link.href, /^https:\/\//, `${link.id} uses an absolute https URL`);
  }
  assert.equal(SITE_CHROME.links.find((link) => link.id === "github")?.href, SITE_CHROME.repository);

  assert.deepEqual(Object.keys(SITE_CHROME.sites).sort(), ["docs", "manual", "site"]);
  assert.equal(SITE_CHROME.sites.site.name, SITE_CHROME.brand);
  assert.equal(SITE_CHROME.sites.site.kind, undefined);
  assert.deepEqual(SITE_CHROME.sites.docs, { name: SITE_CHROME.brand, kind: "docs" });
  assert.deepEqual(SITE_CHROME.sites.manual, { name: SITE_CHROME.brand, kind: "manual" });

  assert.equal(SITE_CHROME.mark.viewBox, "0 0 64 64");
  assert.match(SITE_CHROME.mark.svg, /<svg class="mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">/);
  assert.match(SITE_CHROME.mark.svg, /<rect x="7" y="7" width="50" height="50" rx="11"[^>]*stroke="currentColor"/);
  assert.match(SITE_CHROME.mark.svg, /d="M21 23L34 32L21 41"[^>]*stroke="currentColor"/);
  assert.match(SITE_CHROME.mark.svg, /d="M38 43H48"[^>]*stroke="var\(--color-accent\)"/);
  assert.doesNotMatch(SITE_CHROME.mark.svg, /#[0-9a-fA-F]{3,8}\b/, "the inline mark uses token colours only");
});

test("siteChromeLinks marks only the active site and applies selfHref when supplied", () => {
  const docs = siteChromeLinks("docs");
  assert.deepEqual(
    docs.filter((link) => link.current).map((link) => link.id),
    ["docs"],
  );
  assert.equal(docs.find((link) => link.id === "docs")?.href, "https://docs.buildanagent.fyi");

  const site = siteChromeLinks("site", { selfHref: "/" });
  assert.deepEqual(
    site.filter((link) => link.current).map((link) => link.id),
    ["site"],
  );
  assert.equal(site.find((link) => link.id === "site")?.href, "/");
});

test("the built manual header renders the shared mark, wordmark and all four cross-site links in order", () => {
  const expected = siteChromeLinks("manual", { selfHref: "/" });
  for (const page of ["index.html", join("call-workflow-loop", "index.html")]) {
    const html = readFileSync(join(builtBook(), page), "utf8");
    const title = /<a class="site-header__title" href="\/">([\s\S]*?)<\/a>/.exec(html)?.[1] ?? "";
    assert.ok(title.includes(SITE_CHROME.mark.svg), `${page}: the header title inlines the shared prompt mark`);
    assert.ok(title.includes(SITE_CHROME.sites.manual.name), `${page}: the header title carries the shared brand name`);
    assert.ok(
      title.includes(`<span class="site-header__kind">${SITE_CHROME.sites.manual.kind}</span>`),
      `${page}: the header title carries the manual kind label`,
    );

    const sitesNav =
      /<nav class="site-header__sites" aria-label="buildanagent sites">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    const desktopLinks = [...sitesNav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(
      ([, href, attrs, label]) => ({
        href,
        label,
        current: attrs?.includes('aria-current="true"') ?? false,
      }),
    );
    assert.deepEqual(
      desktopLinks,
      expected.map((link) => ({ href: link.href, label: link.label, current: Boolean(link.current) })),
      page,
    );

    const menuSites = /<div class="site-menu__sites">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    const phoneLinks = [...menuSites.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(
      ([, href, attrs, label]) => ({
        href,
        label,
        current: attrs?.includes('aria-current="true"') ?? false,
      }),
    );
    assert.deepEqual(phoneLinks, desktopLinks, page);
  }
});
