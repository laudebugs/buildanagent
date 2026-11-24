import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE_CHROME, siteChromeLinks } from "@buildanagent/manual/site-chrome";
import { test } from "vitest";
import { docsWordmark, githubLink, logoMark, mainDocsLink, mainDocsLinkFor, siteLinks } from "../src/chrome.js";
import { builtSite } from "./built.js";

test("the docs header reads its links, mark and wordmark from the shared site-chrome source", () => {
  const expected = siteChromeLinks("docs");
  assert.deepEqual(
    [
      ...siteLinks.map((link) => ({ label: link.label, href: link.href })),
      { label: githubLink.label, href: githubLink.href },
    ],
    expected.map((link) => ({ label: link.label, href: link.href })),
  );
  assert.deepEqual(
    siteLinks.filter((link) => link.current).map((link) => link.label),
    ["Docs"],
  );
  assert.deepEqual(docsWordmark, SITE_CHROME.sites.docs);
  assert.equal(logoMark, SITE_CHROME.mark.svg);
});

test("the built docs header renders every shared link and mark on both splash and content pages", () => {
  for (const page of ["index.html", join("start", "install", "index.html")]) {
    const html = readFileSync(join(builtSite(), page), "utf8");
    const nav =
      /<nav class="site-links[^"]*" aria-label="buildanagent sites"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    const rendered = [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(([, href, attrs, label]) => ({
      href,
      label: label?.trim(),
      current: attrs?.includes('aria-current="true"') ?? false,
    }));
    assert.deepEqual(
      rendered,
      siteLinks.map((link) => ({ href: link.href, label: link.label, current: Boolean(link.current) })),
      page,
    );
    assert.ok(html.includes(SITE_CHROME.mark.svg), `${page}: renders the shared inline mark`);
    assert.ok(html.includes(`href="${githubLink.href}"`), `${page}: links to GitHub from the shared source`);
  }
});

test("the 'Docs for main' link appears once the SDK is stable and not while only alphas exist", () => {
  for (const alpha of ["0.1.0-alpha.0", "0.1.0-alpha.34"]) assert.equal(mainDocsLinkFor(alpha), undefined, alpha);
  for (const stable of ["0.1.0", "1.0.0", "1.2.3"]) assert.equal(mainDocsLinkFor(stable), mainDocsLink, stable);
  assert.equal(new URL(mainDocsLink.href).hostname, "next.docs.buildanagent.fyi");
  assert.equal(mainDocsLink.label, "Docs for main");
});

test("a prerelease other than alpha has no rule, so the link decision throws instead of guessing", () => {
  assert.throws(() => mainDocsLinkFor("0.2.0-beta.1"), /no install-line rule/);
});
