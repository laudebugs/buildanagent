import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { DOCS_DIR } from "../src/plugins/pages.js";
import { builtSite } from "./built.js";

// Each package's `@module` comment links its quick start, so the generated reference index leads a reader to the guide.
// The link is an absolute address because the same TSDoc reaches readers outside these docs, in an editor's hover or on
// npm, where a site-relative path would lead nowhere. A preview build therefore links to the production page.
const SITE = "https://docs.buildanagent.fyi";

for (const folder of ["protocol", "cli"]) {
  test(`the ${folder} reference index links the ${folder} quick start, which is a page of these docs`, () => {
    const page = `${folder}/quick-start`;
    assert.ok(existsSync(`${DOCS_DIR}${page}.md`), `${page} has no page`);
    const index = readFileSync(`${builtSite()}/reference/${folder}/index.html`, "utf8");
    assert.ok(index.includes(`href="${SITE}/${page}/"`), `the ${folder} reference index lacks the quick-start link`);
  });
}
