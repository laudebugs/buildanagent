import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { builtPages } from "../src/csp/policy.js";
import { builtSite } from "./built.js";

// The docs show the same tab icon as the landing page, so public/favicon.svg must stay a byte-for-byte copy of the
// site's, and every built page must link it. The check reads the built docs, because Starlight writes the link at
// build time from its `favicon` option.
const app = fileURLToPath(new URL("..", import.meta.url));
const siteIcon = fileURLToPath(new URL("../../site/public/favicon.svg", import.meta.url));
// test/built-site.ts builds the docs once for every file that reads built pages.

test("public/favicon.svg is a byte-for-byte copy of the site's, and the build ships it", () => {
  assert.ok(existsSync(join(app, "public", "favicon.svg")), "public/favicon.svg is missing");
  const site = readFileSync(siteIcon);
  assert.ok(
    readFileSync(join(app, "public", "favicon.svg")).equals(site),
    "public/favicon.svg differs from the site's",
  );
  assert.ok(
    readFileSync(join(builtSite(), "favicon.svg")).equals(site),
    "the build's favicon.svg differs from the site's",
  );
});

test("every built page links /favicon.svg as its icon", () => {
  const pages = builtPages(builtSite());
  assert.ok(pages.length > 0, "the build wrote no pages");
  for (const { path, html } of pages) {
    // Starlight writes rel="shortcut icon"; a page may use either spelling.
    assert.match(
      html,
      /<link rel="(?:shortcut )?icon" href="\/favicon\.svg" type="image\/svg\+xml"\s*\/?>/,
      `${path}: no icon link`,
    );
  }
});

test("every built page has the header title with the mark, the wordmark and the licence line, and the install tabs sync", () => {
  const out = builtSite();
  for (const { path, html } of builtPages(out)) {
    const link = /<a href="\/"[^>]*class="site-title[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1] ?? "";
    assert.match(link, /<svg[^>]*aria-hidden="true"/, `${path}: no mark in the header title`);
    assert.match(link, /Build An Agent<\/span> <span class="kind[^"]*">docs<\/span>/, `${path}: no wordmark`);
    assert.match(
      html,
      /<a href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[^>]*>CC BY 4\.0<\/a>/,
      `${path}: no licence`,
    );
  }
  // The Install page is MDX with package-manager tabs, so Starlight's synced tabs are on the page.
  const install = readFileSync(join(out, "start", "install", "index.html"), "utf8");
  assert.match(install, /data-sync-key="package-manager"/);
  const tabs = [...install.matchAll(/<a role="tab"[^>]*>([^<]*)<\/a>/g)].map((m) =>
    (m[1] ?? "").replace(/<[^>]*>/g, "").trim(),
  );
  assert.deepEqual(tabs, ["pnpm", "npm", "yarn"]);
});
