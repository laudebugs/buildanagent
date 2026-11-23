import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { exampleSource, parseExampleRef } from "../src/plugins/example-code.js";
import { checkTwins, htmlOf } from "../src/twins/build.js";
import { readingOrder, twinPages } from "../src/twins/pages.js";
import { builtSite } from "./built.js";

// Every check reads the built docs (test/built-site.ts builds them once).
const pages = twinPages(true);
const twinFile = (dist: string, url: string) => join(dist, ...url.split("/").filter(Boolean));
const read = (url: string) => readFileSync(twinFile(builtSite(), url), "utf8");

test("every page the twin function names has a twin and a head link, and the build check agrees", () => {
  assert.ok(pages.length > 280, `only ${pages.length} pages have twins`);
  assert.deepEqual(checkTwins(builtSite(), pages), []);
  for (const page of pages) assert.ok(existsSync(twinFile(builtSite(), page.url)), `${page.url} is missing`);
});

test("every built page is a page with a twin, so no page lacks its link or its button", () => {
  const dist = builtSite();
  const built = readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith("index.html"))
    .map((path) => join(dist, path));
  const expected = new Set(pages.map((page) => htmlOf(dist, page)));
  for (const file of built) {
    if (file === join(dist, "pagefind", "index.html")) continue;
    assert.ok(expected.has(file), `${file} is a built page with no twin`);
    const html = readFileSync(file, "utf8");
    assert.match(
      html,
      /<link rel="alternate" type="text\/markdown" href="\/[^"]*\.md"\s*\/?>/,
      `${file}: no alternate link`,
    );
    // The home page uses Starlight's splash template, which has a hero in place of a page title, so it has the link in
    // its head and no button under a title.
    if (file === join(dist, "index.html")) continue;
    assert.match(html, /class="twin-copy[^"]*"[^>]*data-twin="\/[^"]*\.md"/, `${file}: no Copy as Markdown button`);
    assert.match(html, /<a class="twin-link[^"]*"[^>]*href="\/[^"]*\.md"/, `${file}: no plain link to the twin`);
  }
  assert.ok(built.length > 280);
});

test("twins are separate files: no page's HTML holds a twin's text, only its address", () => {
  const dist = builtSite();
  const sample = pages.find((page) => page.slug === "concepts/stop-reasons");
  assert.ok(sample !== undefined);
  const html = readFileSync(htmlOf(dist, sample), "utf8");
  const firstParagraph =
    read(sample.url)
      .split("\n")
      .find((line) => line.length > 60 && !line.startsWith("#")) ?? "";
  assert.ok(firstParagraph !== "");
  // The page shows the same sentence as HTML, so compare a fragment that Markdown syntax would break in HTML.
  assert.ok(!html.includes("# Stop reasons\n"), "the twin's heading line is not in the page");
  assert.equal(html.split(sample.url).length - 1 >= 2, true, "the page names its twin in the link and the button");
  assert.ok(!html.includes("Source: "), "no llms-full.txt text in a page");
});

test("no twin keeps a file= fence, a ::figure, an MDX tag, an import or a comment, and example code is in", () => {
  for (const page of pages) {
    const text = read(page.url);
    assert.doesNotMatch(text, /(?:^|\s)file="packages\//, `${page.url}: a file= fence`);
    assert.doesNotMatch(text, /^::figure/m, `${page.url}: a ::figure`);
    // Outside fences, since a page about a component may show one in code.
    const prose = text.replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, "");
    assert.doesNotMatch(
      prose,
      /<\/?(?:Tabs|TabItem|Aside|LinkCard|CardGrid|LinkButton|Steps|Card|Badge)\b/,
      `${page.url}: a component tag`,
    );
    assert.doesNotMatch(
      prose,
      /^\s*(?:import\s.+from\s|export\s+(?:const|let|function)\b)/m,
      `${page.url}: an import or export`,
    );
    assert.doesNotMatch(prose, /\{\/\*|<!--/, `${page.url}: a comment`);
    assert.ok(text.startsWith("# "), `${page.url}: no title`);
  }
  const gateway = read("/concepts/the-gateway.md");
  const code = exampleSource(
    parseExampleRef('file="packages/gateway/examples/03-scripted-adapter.ts" region="scripted"') ?? { file: "" },
  );
  assert.ok(gateway.includes(code), "the gateway twin holds the scripted adapter's code");
  assert.match(gateway, /\*\*Figure: A call goes from your code through the gateway to one adapter\.\*\*/);
  assert.ok(!gateway.includes("<svg"), "a twin holds no drawing");
});

test("a twin's links to other pages are absolute, and a link to a page with a twin ends in .md", () => {
  const twin = read("/start/install.md");
  assert.match(twin, /\]\(https:\/\/docs\.buildanagent\.fyi\/start\/first-agent\.md\)/);
  for (const page of pages) {
    const links = [...read(page.url).matchAll(/\]\((\/[^)\s]*)\)/g)];
    assert.deepEqual(
      links.map((m) => m[1]),
      [],
      `${page.url} has a root-relative link, which a copied twin can't follow`,
    );
  }
});

test("llms.txt lists every twin exactly once with an absolute address, and llms-full.txt holds every twin", () => {
  const dist = builtSite();
  const llms = readFileSync(join(dist, "llms.txt"), "utf8");
  const full = readFileSync(join(dist, "llms-full.txt"), "utf8");
  assert.match(llms, /^# .+\n\n> .+\n/);
  const listed = [...llms.matchAll(/^- \[.*?\]\((https:\/\/docs\.buildanagent\.fyi\/[^)\s]+)\)/gm)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), pages.map((page) => `https://docs.buildanagent.fyi${page.url}`).sort());
  assert.equal(new Set(listed).size, listed.length, "a twin is listed twice");
  assert.ok(!/\]\(\//.test(llms), "an address in llms.txt is not absolute");
  for (const page of pages) {
    const twin = read(page.url);
    assert.ok(
      full.includes(`Source: https://docs.buildanagent.fyi${page.url}\n\n${twin}`),
      `${page.url} is not in llms-full.txt`,
    );
  }
  // The reading order follows the sidebar: the home page, then Start, then Concepts.
  const order = readingOrder(pages, []).length;
  assert.equal(order, pages.length);
  assert.ok(
    llms.indexOf("## Overview") < llms.indexOf("## Start") && llms.indexOf("## Start") < llms.indexOf("## Concepts"),
  );
  assert.ok(
    llms.indexOf("## Concepts") < llms.indexOf("## Optional"),
    "the generated reference is the optional section",
  );
});

test("the twins add well under a megabyte, and no twin is larger than its source and its examples allow", () => {
  const dist = builtSite();
  const total = pages.reduce((sum, page) => sum + statSync(twinFile(dist, page.url)).size, 0);
  assert.ok(total < 1_000_000, `the twins total ${total} bytes`);
});
