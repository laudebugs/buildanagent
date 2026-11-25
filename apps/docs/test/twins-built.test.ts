import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { exampleSource, parseExampleRef } from "../src/plugins/example-code.js";
import { checkTwins, htmlOf } from "../src/twins/build.js";
import { twinPages } from "../src/twins/pages.js";
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

test("every built page is a page with a twin, so no page lacks its link or its button, and the 404 page has neither", () => {
  const dist = builtSite();
  const built = readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".html"))
    .map((path) => join(dist, path));
  const expected = new Set(pages.map((page) => htmlOf(dist, page)));
  const notFound = join(dist, "404.html");
  assert.ok(built.includes(notFound), "the build has a 404 page");
  for (const file of built) {
    if (file.startsWith(join(dist, "pagefind"))) continue;
    const html = readFileSync(file, "utf8");
    if (file === notFound) {
      assert.doesNotMatch(html, /type="text\/markdown"/, "the 404 page links a twin that is not built");
      assert.doesNotMatch(html, /twin-copy|twin-link/, "the 404 page has a Markdown button");
      continue;
    }
    assert.ok(expected.has(file), `${file} is a built page with no twin`);
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
  assert.equal(
    readFileSync(htmlOf(dist, sample), "utf8").split(sample.url).length - 1 >= 2,
    true,
    "the page names its twin in the link and the button",
  );
  // Markdown-only text: a fence line of code, a Markdown link to a twin, the "Source:" line of llms-full.txt, and the
  // twin's own heading line. HTML writes each of these with tags and entities, so one in a page means a twin was
  // inlined, for instance in a <script type="text/markdown">.
  for (const page of pages) {
    const html = readFileSync(htmlOf(dist, page), "utf8");
    const twin = read(page.url);
    assert.doesNotMatch(html, /<script[^>]*type="text\/markdown"/, `${page.url}: a twin in a script tag`);
    assert.doesNotMatch(
      html,
      /\]\((?:https:\/\/docs\.buildanagent\.fyi)?\/[^)\s]*\.md\)/,
      `${page.url}: a Markdown link`,
    );
    assert.ok(!html.includes("Source: https://"), `${page.url}: llms-full.txt text`);
    assert.ok(!html.includes(`${twin.split("\n")[0]}\n\n`), `${page.url}: the twin's heading line`);
    const fenced = twin.split("\n").find((line, i, all) => line.length > 30 && all[i - 1]?.startsWith("```"));
    if (fenced !== undefined) assert.ok(!html.includes(`\n${fenced}\n`), `${page.url}: a code line of the twin, raw`);
    // A long line with Markdown syntax (a link or bold text) is in the page as tags, never as the twin's raw line.
    const long = twin.split("\n").filter((line) => line.length > 60 && /\]\(|^> \*\*|^\*\*/.test(line));
    for (const line of long.slice(0, 3)) assert.ok(!html.includes(line), `${page.url}: twin text inline`);
  }
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

test("a twin's links are absolute, and every .md address it links is a twin that was written", () => {
  const twin = read("/start/install.md");
  assert.match(twin, /\]\(https:\/\/docs\.buildanagent\.fyi\/start\/first-agent\.md\)/);
  const origin = "https://docs.buildanagent.fyi";
  for (const page of pages) {
    // Outside fences, since a page about links may show one in code.
    const prose = read(page.url).replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, "");
    // An inline link or an image, a reference definition in any spacing, and an angle-bracket form.
    const relative = [...prose.matchAll(/\]\(\s*<?(\/[^)\s>]*)|^\[[^\]]+\]:\s*<?(\/\S*)/gm)];
    assert.deepEqual(
      relative.map((m) => m[1] ?? m[2]),
      [],
      `${page.url} has a root-relative link, image or definition, which a copied twin can't follow`,
    );
    for (const [, path] of prose.matchAll(
      new RegExp(`\\]\\(<?${origin.replace(/\./g, "\\.")}(/[^)\\s>#?]*\\.md)`, "g"),
    )) {
      assert.ok(existsSync(twinFile(builtSite(), path ?? "")), `${page.url} links ${path}, which is not a twin`);
    }
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
  // The reading order follows the sidebar: the home page, then Start, then Concepts. The headings are read from the
  // built file, which the plugin wrote from the real sidebar, so this checks the order the site ships; a call to
  // readingOrder here would need the sidebar, which only astro.config.mjs holds, and test/twins-pages.test.ts covers
  // readingOrder on a sidebar of its own.
  assert.ok(
    llms.indexOf("## Overview") < llms.indexOf("## Start") && llms.indexOf("## Start") < llms.indexOf("## Concepts"),
  );
  assert.ok(
    llms.indexOf("## Concepts") < llms.indexOf("## Optional"),
    "the generated reference is the optional section",
  );
});

test("the twins stay under 2.5 MB across all six packages", () => {
  const dist = builtSite();
  const total = pages.reduce((sum, page) => sum + statSync(twinFile(dist, page.url)).size, 0);
  // 964 twins across six packages total ~1.28 MB; 2.5 MB leaves room for upcoming written guides while catching bloat.
  assert.ok(total < 2_500_000, `the twins total ${total} bytes`);
});
