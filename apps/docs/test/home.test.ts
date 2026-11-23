import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { DOCS_DIR } from "../src/plugins/pages.js";
import { builtSite } from "./built.js";

// The home page is design A, a grid of one card per package. These tests read its source and check that every card
// leads somewhere real and that its install line is the Install page's. No build and no network.
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const home = readFileSync(`${DOCS_DIR}index.mdx`, "utf8");
const install = readFileSync(`${DOCS_DIR}start/install.mdx`, "utf8");

const PACKAGES = [
  ["Gateway", "gateway"],
  ["SDK", "sdk"],
  ["Harness", "harness"],
  ["Agent safety", "agent-safety"],
  ["Protocol", "protocol"],
  ["CLI", "cli"],
] as const;
const README_URL = "https://github.com/laudebugs/buildanagent/blob/main/packages/";

const cards = [...home.matchAll(/<LinkCard\s+title="([^"]+)"[^>]*\shref="([^"]+)"/g)].map((m) => ({
  title: m[1] ?? "",
  href: m[2] ?? "",
}));

/** The commands in a page's bash fences, in order. */
const commands = (text: string) => [...text.matchAll(/^\s*```bash\n\s*([^\n]+)\n\s*```/gm)].map((m) => m[1]);

describe("the home page", () => {
  test("has exactly six cards, one per package, in the order of the design", () => {
    assert.deepEqual(
      cards.map((card) => card.title),
      PACKAGES.map(([title]) => title),
    );
    assert.equal((home.match(/<LinkCard\b/g) ?? []).length, 6);
  });

  test("leads the gateway and the SDK to pages of these docs that exist", () => {
    for (const [title, target] of [
      ["Gateway", "/start/install/"],
      ["SDK", "/start/first-agent/"],
    ] as const) {
      const card = cards.find((entry) => entry.title === title);
      assert.equal(card?.href, target);
      const slug = target.replace(/^\/|\/$/g, "");
      assert.ok(
        existsSync(`${DOCS_DIR}${slug}.md`) || existsSync(`${DOCS_DIR}${slug}.mdx`),
        `${target} has no page`,
      );
    }
  });

  test("leads each of the other four packages to its README, which exists in the repository", () => {
    for (const [title, folder] of PACKAGES.slice(2)) {
      const card = cards.find((entry) => entry.title === title);
      assert.equal(card?.href, `${README_URL}${folder}/README.md`);
      assert.ok(existsSync(`${REPO}packages/${folder}/README.md`), `${folder} has no README`);
    }
  });

  test("shows the Install page's alpha command for every package manager", () => {
    const shown = commands(home);
    assert.equal(shown.length, 3);
    assert.deepEqual(shown, commands(install));
    for (const command of shown) assert.match(command ?? "", /@buildanagent\/sdk@alpha .*@buildanagent\/gateway@alpha/);
  });

  test("links the manual and a guide page that exists", () => {
    assert.match(home, /href="https:\/\/manual\.buildanagent\.fyi"/);
    const guide = /href="(\/guides\/[^"]+)"/.exec(home)?.[1];
    assert.ok(guide, "a guide link");
    const slug = guide.replace(/^\/|\/$/g, "");
    assert.ok(existsSync(`${DOCS_DIR}${slug}.md`) || existsSync(`${DOCS_DIR}${slug}.mdx`), `${guide} has no page`);
  });

  test("writes each button's label inline, so MDX adds no paragraph inside the link", () => {
    for (const label of ["Open the manual", "Read the guides"]) {
      assert.match(home, new RegExp(`<LinkButton [^>]*>${label}</LinkButton>`));
    }
  });
});

describe("the home page's styles", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles/starlight.css", import.meta.url)), "utf8");

  test("keep the docs' link underline and hover colour off a button, which is itself a .not-content anchor", () => {
    assert.match(css, /\.sl-markdown-content a:not\(\.not-content, :where\(\.not-content \*\)\) \{/);
    assert.match(css, /\.sl-markdown-content a:hover:not\(\.not-content, :where\(\.not-content \*\)\) \{/);
    assert.doesNotMatch(css, /a(?::hover)?:not\(:where\(\.not-content \*\)\) \{/);
  });

  test("apply only where there is a card grid, because the fallback 404 page also sets data-has-hero", () => {
    const uses = css.match(/\[data-has-hero\][^\s{,]*/g) ?? [];
    assert.ok(uses.length > 5);
    for (const use of uses) assert.equal(use, "[data-has-hero]:has(.card-grid)");
    const site = builtSite();
    const notFound = readFileSync(`${site}/404.html`, "utf8");
    assert.match(notFound, /data-has-hero/, "the premise: the 404 page sets data-has-hero");
    assert.doesNotMatch(notFound, /card-grid/);
    assert.match(readFileSync(`${site}/index.html`, "utf8"), /card-grid/);
  });
});
