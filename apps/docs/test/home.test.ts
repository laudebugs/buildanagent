import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { DOCS_DIR } from "../src/plugins/pages.js";
import { builtSite } from "./built.js";

// The home page is design A, a grid of one card per package. These tests check that every card leads to a real page in
// these docs and that its install line matches the Install page.
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
      assert.ok(existsSync(`${DOCS_DIR}${slug}.md`) || existsSync(`${DOCS_DIR}${slug}.mdx`), `${target} has no page`);
    }
  });

  test("leads the protocol and the CLI to their quick starts, which exist and are in the sidebar", () => {
    for (const [title, folder] of PACKAGES.filter(([name]) => name === "Protocol" || name === "CLI")) {
      const target = `/${folder}/quick-start/`;
      const card = cards.find((entry) => entry.title === title);
      assert.equal(card?.href, target);
      const slug = target.replace(/^\/|\/$/g, "");
      assert.ok(existsSync(`${DOCS_DIR}${slug}.md`) || existsSync(`${DOCS_DIR}${slug}.mdx`), `${target} has no page`);
      assert.ok(existsSync(`${builtSite()}/${slug}/index.html`), `${target} has no built page`);
    }
  });

  test("leads the harness and agent safety to their API reference pages in the built docs", () => {
    const site = builtSite();
    for (const [title, folder] of PACKAGES.filter(([name]) => name === "Harness" || name === "Agent safety")) {
      const card = cards.find((entry) => entry.title === title);
      assert.equal(card?.href, `/reference/${folder}/`);
      assert.ok(existsSync(`${site}/reference/${folder}/index.html`), `/reference/${folder}/ has no built page`);
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
    // The markup, not the word: the topic tabs import Starlight's component barrel, so its card-grid CSS is inlined.
    // A class attribute in either quote style, or an element named for the grid, would be markup.
    assert.doesNotMatch(notFound, /\bclass\s*=\s*["'][^"']*\bcard-grid\b/);
    assert.doesNotMatch(notFound, /<[a-z-]*card-grid\b/i);
    assert.match(readFileSync(`${site}/index.html`, "utf8"), /card-grid/);
  });
});
