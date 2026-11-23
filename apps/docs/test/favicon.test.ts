import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inject, test } from "vitest";

// The docs show the same tab icon as the landing page, so public/favicon.svg must stay a byte-for-byte copy of the
// site's, and every built page must link it. The check reads the built docs, because Starlight writes the link at
// build time from its `favicon` option.
const app = fileURLToPath(new URL("..", import.meta.url));
const siteIcon = fileURLToPath(new URL("../../site/public/favicon.svg", import.meta.url));
// test/built-site.ts builds the docs once for every file that reads built pages.
const out = inject("builtSite");

test("public/favicon.svg is a byte-for-byte copy of the site's, and the build ships it", () => {
  assert.ok(existsSync(join(app, "public", "favicon.svg")), "public/favicon.svg is missing");
  const site = readFileSync(siteIcon);
  assert.ok(
    readFileSync(join(app, "public", "favicon.svg")).equals(site),
    "public/favicon.svg differs from the site's",
  );
  assert.ok(readFileSync(join(out, "favicon.svg")).equals(site), "the build's favicon.svg differs from the site's");
});

test("every built page links /favicon.svg as its icon", () => {
  const pages = readdirSync(out, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".html"));
  assert.ok(pages.length > 0, "the build wrote no pages");
  for (const path of pages) {
    const html = readFileSync(join(out, path), "utf8");
    // Starlight writes rel="shortcut icon"; a page may use either spelling.
    assert.match(
      html,
      /<link rel="(?:shortcut )?icon" href="\/favicon\.svg" type="image\/svg\+xml"\s*\/?>/,
      `${path}: no icon link`,
    );
  }
});
