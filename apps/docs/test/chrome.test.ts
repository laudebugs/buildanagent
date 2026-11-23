import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { siteLinks } from "../src/chrome.js";

const SITE_COPY_URL = new URL("../../site/src/landing/copy.ts", import.meta.url);

/** The `{ label, href }` entries of `nav` in the site's landing copy, in order. */
function siteNav(): { label: string; href: string }[] {
  const source = readFileSync(SITE_COPY_URL, "utf8");
  const block = /nav:\s*\[([\s\S]*?)\],/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/label:\s*"([^"]+)",\s*href:\s*([^}]+?)\s*\}/g)].map((m) => ({
    label: m[1] as string,
    href: (m[2] as string).replace(/^"|"$/g, ""),
  }));
}

test("the docs header lists the site's links in the site's order, with GitHub left to the social icon", () => {
  const nav = siteNav();
  assert.deepEqual(
    nav.map((link) => link.label),
    [...siteLinks.map((link) => link.label), "GitHub"],
  );
});

test("the docs header links to the same addresses as the site's header, and marks only Docs as current", () => {
  const nav = siteNav();
  for (const link of siteLinks) {
    const theirs = nav.find((entry) => entry.label === link.label);
    // The site's own link to itself is the relative "/", which the docs write as the site's origin.
    const expected = theirs?.href === "/" ? "https://buildanagent.fyi" : theirs?.href;
    assert.equal(link.href, expected, link.label);
  }
  assert.deepEqual(
    siteLinks.filter((link) => link.current).map((link) => link.label),
    ["Docs"],
  );
});
