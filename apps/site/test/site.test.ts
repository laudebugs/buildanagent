import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, inject, test } from "vitest";
import { copy } from "../src/landing/copy.js";
import { ROOT } from "./build.js";

const FIGURE_ALT: string = copy.figure.alt;

const PAGES = join(ROOT, "src/pages");
const OUT = inject("siteOut");
const ROUTES = ["", "packages/gateway", "packages/sdk"];

const htmlOf = (route: string) => readFileSync(join(OUT, route, "index.html"), "utf8");

describe("the built site", () => {
  test("writes a static page for the landing page and each package", () => {
    for (const route of ROUTES) assert.ok(existsSync(join(OUT, route, "index.html")), `/${route}`);
  });

  test("gives every page a title, a description and the licence footer", () => {
    for (const route of ROUTES) {
      const html = htmlOf(route);
      assert.match(html, /<title>[^<]+<\/title>/, route);
      assert.match(html, /<meta name="description" content="[^"]+"/, route);
      assert.match(html, /Apache-2\.0 OR MIT/, `${route} names the code licence`);
      assert.match(html, /CC BY 4\.0/, `${route} names the content licence`);
    }
  });

  test("links every page to the docs and the repository", () => {
    for (const route of ROUTES) {
      const html = htmlOf(route);
      assert.match(html, /href="https:\/\/docs\.buildanagent\.fyi"/, route);
      assert.match(html, /href="https:\/\/github\.com\/laudebugs\/buildanagent"/, route);
    }
  });

  test("points every internal link at a page that was built", () => {
    for (const route of ROUTES) {
      // A link to a page has no file extension; an asset such as a stylesheet or an icon does.
      for (const [, href] of htmlOf(route).matchAll(/href="(\/[^"#.]*)"/g)) {
        assert.ok(existsSync(join(OUT, href ?? "", "index.html")), `${route} links to ${href}, which was not built`);
      }
    }
  });
});

// The rules of docs/guidelines/docs-writing.md that a program can check, over the Markdown of every page.
const BANNED = /\b(simply|just|easy|easily|obviously|please|utilize|via|etc)\b|note that|!/i;
const LEAKS = /\b(?:packages|apps|docs|scripts)\/|\bCI\b|\bADR\b|\b(?:D|HD|BK|DS|PB)\d+\b/;

function todoIds(): string[] {
  const root = fileURLToPath(new URL("../../../docs/todos/", import.meta.url));
  return readdirSync(root, { recursive: true })
    .map((name) => /^(?:\w+\/)?([A-Z]+\d+[a-z]?)-/.exec(String(name))?.[1])
    .filter((id): id is string => id !== undefined);
}

const IDS = new RegExp(`\\b(?:${[...new Set(todoIds())].join("|")})\\b`);
const words = (text: string) => text.split(/\s+/).filter((word) => word !== "");
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

/** The text a reader sees on a built page: inline tags removed, each block its own paragraph, code and figures left out. */
function proseOfHtml(route: string): { description: string; paragraphs: string[]; text: string } {
  const html = htmlOf(route);
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
  const main = /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
  const blocks = main
    .replace(/<(svg|pre)[\s\S]*?<\/\1>/g, "\n")
    .replace(/<\/?(?:a|em|i|b|strong|code|span)(?:\s[^>]*)?>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return { description, paragraphs: blocks, text: `${description} ${blocks.join(" ")} ${FIGURE_ALT}` };
}

/** A page's body: Markdown for a package page, the built HTML for the landing page. */
function prose(route: string): { description: string; paragraphs: string[]; text: string } {
  if (route === "") return proseOfHtml(route);
  const file = join(PAGES, `${route}.md`);
  const source = readFileSync(file, "utf8");
  const description = /^description: (.*)$/m.exec(source)?.[1] ?? "";
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/```[\s\S]*?```/g, "");
  const paragraphs = body
    .split(/\n\s*\n/)
    .flatMap((block) => (/^\s*-\s/.test(block) ? block.split(/\n(?=\s*-\s)/) : [block]))
    .map((block) => plain(block.replace(/^\s*-\s+/, "").replace(/\n/g, " ")).trim())
    .filter((block) => block !== "" && !block.startsWith("#"));
  return { description, paragraphs, text: plain(`${description} ${body}`) };
}

describe.each(ROUTES.map((route) => [route || "/", route] as const))("the copy of %s", (_name, route) => {
  test("opens with a paragraph of 50 words or fewer", () => {
    const { description, paragraphs } = prose(route);
    assert.ok(description !== "", "has a description");
    assert.ok(words(paragraphs[0] ?? "").length <= 50, paragraphs[0] ?? "no paragraph");
  });

  test("keeps sentences to 40 words and paragraphs to 100", () => {
    const { paragraphs } = prose(route);
    for (const paragraph of paragraphs) {
      assert.ok(words(paragraph).length <= 100, paragraph);
      for (const sentence of paragraph.split(/(?<=[.?!])\s+(?=[A-Z`*])/)) {
        assert.ok(words(sentence).length <= 40, sentence);
      }
    }
  });

  test("names no todo, decision or round id, repository path or banned word", () => {
    const { text } = prose(route);
    assert.equal(IDS.exec(text)?.[0], undefined);
    assert.equal(LEAKS.exec(text)?.[0], undefined);
    assert.equal(BANNED.exec(text)?.[0], undefined);
  });
});
