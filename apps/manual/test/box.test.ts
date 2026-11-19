import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import { loadBook } from "../src/book/load.js";
import { edit, fixtureInputs, mutatedFixture, removeFixture, renderLikeAstro } from "./book-fixture.js";

// A box as the build renders it: an <aside> named by its title, holding Markdown and a numbered file listing.
// check-book.test.ts holds one failing fixture per rule a box keeps.

const BOX = `## How the fixture runs

:::box[The fixture runs offline]{#fixture-runs-offline}
The example in [[lst:boxed]] runs offline, like :analogy[the ticket rail]{#kitchen-ticket-rail}.

::listing[A listing inside a box]{#boxed file="verify/demo-sdk/examples/01-hello.ts" region="greet"}
:::

[Back to the box](#fixture-runs-offline).

## Exercises`;

// Tabs inside a box: the box's title is a level-3 heading under the section's level-2 heading, so the tab headings
// sit one level below it, at level 4.
const TABBED = `## Two harnesses

:::box[The same call in two harnesses]{#same-call}
Each tab shows the call in one harness.

::::tabs
::listing[demo-sdk]{#hello-demo file="verify/demo-sdk/examples/01-hello.ts" region="call"}
::listing[other-sdk]{#hello-other file="verify/other-sdk/examples/01-other.ts" region="call"}
::::
:::

## Exercises`;

const dir = mutatedFixture((copy) => edit(copy, "chapters/second.md", (text) => text.replace("## Exercises", BOX)));
const html = await renderLikeAstro(loadBook(fixtureInputs(dir)), "second");
const tabbedDir = mutatedFixture((copy) =>
  edit(copy, "chapters/second.md", (text) => text.replace("## Exercises", TABBED)),
);
const tabbedHtml = await renderLikeAstro(loadBook(fixtureInputs(tabbedDir)), "second");
afterAll(() => {
  removeFixture(dir);
  removeFixture(tabbedDir);
});
const box = html.slice(html.indexOf('<aside class="box"'), html.indexOf("</aside>") + "</aside>".length);

test("a box is an aside labelled by its title, a heading one level below the heading the box follows", () => {
  assert.match(
    box,
    /^<aside class="box" aria-labelledby="fixture-runs-offline"><h3 class="box__heading" id="fixture-runs-offline">The fixture runs offline<\/h3>/,
  );
  assert.match(
    html,
    /<a href="#fixture-runs-offline">Back to the box<\/a>/,
    "a link to the box's id lands on its title",
  );
});

test("a box's content renders as Markdown, and a file listing in it is numbered and cross-referenced", () => {
  assert.match(box, /<figure id="lst-boxed"[^>]*class="numbered listing panel"/);
  assert.match(box, /<span class="listing__number number">Listing 2\.3<\/span>/);
  assert.match(box, /<a href="\/second\/#lst-boxed" class="xref">Listing 2\.3<\/a>/);
  assert.match(box, /<span class="analogy" data-analogy="kitchen-ticket-rail">the ticket rail<\/span>/);
});

test("a box carries no inline style or script, so it needs nothing from the content security policy", () => {
  assert.doesNotMatch(box, /\sstyle=|<script|\son[a-z]+=/);
});

test("tabs inside a box under a level-2 heading get level-4 tab headings, below the box's level-3 title", () => {
  assert.match(tabbedHtml, /<h3 class="box__heading" id="same-call">The same call in two harnesses<\/h3>/);
  assert.match(tabbedHtml, /<h4 class="tabs__heading" id="lst-hello-demo-heading">demo-sdk<\/h4>/);
  assert.match(tabbedHtml, /<h4 class="tabs__heading" id="lst-hello-other-heading">other-sdk<\/h4>/);
  assert.doesNotMatch(tabbedHtml, /<h3 class="tabs__heading"/);
});
