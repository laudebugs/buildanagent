import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { checkTwins, hasAlternateLink, llmsFullTxt, llmsTxt } from "../src/twins/build.js";
import { OPTIONAL_SECTION, readingOrder, slugOf, type TwinPage } from "../src/twins/pages.js";
import { hasTwin, normalizeSlug, twinHref, twinUrl } from "../src/twins/rule.js";

const page = (slug: string, extra: Partial<TwinPage> = {}): TwinPage => ({
  slug,
  url: twinUrl(slug),
  source: `/x/${slug}.md`,
  mdx: false,
  generated: false,
  title: `Title of ${slug || "home"}`,
  description: `About ${slug || "home"}.`,
  ...extra,
});

test("a twin sits beside its page, and the home page's is /index.md", () => {
  assert.equal(twinUrl("start/install"), "/start/install.md");
  assert.equal(twinUrl("/start/install/"), "/start/install.md");
  assert.equal(twinUrl(""), "/index.md");
  assert.equal(twinUrl("index"), "/index.md");
  assert.equal(normalizeSlug("/a/b/"), "a/b");
  assert.equal(twinHref("a"), "/a.md");
  assert.ok(hasTwin("a") && hasTwin(""));
});

test("a file's slug is the one Starlight gives it", () => {
  assert.equal(slugOf("start/install.mdx"), "start/install");
  assert.equal(slugOf("index.mdx"), "");
  assert.equal(slugOf("reference/sdk/index.md"), "reference/sdk");
  assert.equal(
    slugOf("reference/sdk/@buildanagent/sdk/functions/BlockingApprovals.md"),
    "reference/sdk/buildanagent/sdk/functions/blockingapprovals",
  );
});

test("the reading order is the home page, the sidebar, then any page it leaves out, with the generated reference optional", () => {
  const pages = [
    page(""),
    page("a/one"),
    page("a/two"),
    page("b/three"),
    page("reference/sdk", { generated: true }),
    page("reference/sdk/x", { generated: true }),
    page("loose"),
  ];
  const placed = readingOrder(pages, [
    { label: "B group", items: [{ label: "Three", slug: "b/three" }] },
    {
      label: "Reference",
      items: [{ label: "SDK", autogenerate: { directory: "reference/sdk" } }],
    },
    { label: "A group", items: [{ slug: "a/two" }, { slug: "a/one" }] },
  ]);
  assert.deepEqual(
    placed.map(({ section, page: p }) => `${section}:${p.slug}`),
    [
      "Overview:",
      "B group:b/three",
      `${OPTIONAL_SECTION}:reference/sdk`,
      `${OPTIONAL_SECTION}:reference/sdk/x`,
      "A group:a/two",
      "A group:a/one",
      "More:loose",
    ],
  );
  assert.equal(new Set(placed.map((p) => p.page.slug)).size, pages.length, "every page is placed once");
});

test("llms.txt lists each twin once under its section with an absolute address, the optional section last", () => {
  const placed = readingOrder(
    [page(""), page("a/one"), page("ref/x", { generated: true, description: undefined })],
    [{ label: "Guides", items: [{ slug: "a/one" }] }],
  );
  const site = { origin: "https://docs.test", title: "Docs", summary: "What it is." };
  const text = llmsTxt(placed, site);
  assert.equal(
    text,
    [
      "# Docs",
      "",
      "> What it is.",
      "",
      "## Overview",
      "",
      "- [Title of home](https://docs.test/index.md): About home.",
      "",
      "## Guides",
      "",
      "- [Title of a/one](https://docs.test/a/one.md): About a/one.",
      "",
      "## Optional",
      "",
      "- [Title of ref/x](https://docs.test/ref/x.md)",
      "",
    ].join("\n"),
  );
  const full = llmsFullTxt(placed, new Map(placed.map(({ page: p }) => [p.slug, `# ${p.title}\n`])), site);
  assert.equal(full.match(/^Source: /gm)?.length, 3);
  assert.ok(full.indexOf("Source: https://docs.test/index.md") < full.indexOf("Source: https://docs.test/a/one.md"));
});

/** A fake built site: twins and pages for the slugs given, the page heads written as `head`. */
function fakeDist(slugs: readonly string[], head: (url: string) => string, skipTwin?: string): string {
  const dist = mkdtempSync(join(tmpdir(), "twins-dist-"));
  for (const slug of slugs) {
    const url = twinUrl(slug);
    const folder = join(dist, ...slug.split("/").filter(Boolean));
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "index.html"), `<html><head>${head(url)}</head><body></body></html>`);
    if (slug !== skipTwin) {
      mkdirSync(join(dist, ...url.split("/").slice(1, -1)), { recursive: true });
      writeFileSync(join(dist, ...url.split("/").filter(Boolean)), "# Twin\n");
    }
  }
  return dist;
}

const linkTag = (url: string) => `<link rel="alternate" type="text/markdown" href="${url}">`;

test("the build check passes a site where every page has its twin and its head link", () => {
  const dist = fakeDist(["", "a/one"], linkTag);
  try {
    assert.deepEqual(checkTwins(dist, [page(""), page("a/one")]), []);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("the build check names a page whose twin file, built page or head link is missing", () => {
  const dist = fakeDist(["a/one", "a/two"], (url) => (url === "/a/two.md" ? "" : linkTag(url)), "a/one");
  try {
    const problems = checkTwins(dist, [page("a/one"), page("a/two"), page("a/three")]);
    assert.equal(problems.length, 4);
    assert.match(problems[0] ?? "", /^\/a\/one\.md: the twin was not written/);
    assert.match(problems[1] ?? "", /^\/a\/two\.md: the page's head has no <link rel="alternate"/);
    assert.match(problems[2] ?? "", /^\/a\/three\.md: the twin was not written/);
    assert.match(problems[3] ?? "", /no built page/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("the head link is found whatever order its attributes come in, and only for the right twin", () => {
  assert.ok(hasAlternateLink('<link href="/a.md" type="text/markdown" rel="alternate"/>', "/a.md"));
  assert.ok(!hasAlternateLink(linkTag("/b.md"), "/a.md"));
  assert.ok(!hasAlternateLink('<link rel="alternate" type="application/rss+xml" href="/a.md">', "/a.md"));
});
