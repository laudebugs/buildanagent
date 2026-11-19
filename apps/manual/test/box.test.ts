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
// sit one level below it, at level 4. The paragraph after the box keeps the box inside its section.
const TABBED = `## Two harnesses

::::box[The same call in two harnesses]{#same-call}
Each tab shows the call in one harness.

:::tabs
::listing[demo-sdk]{#hello-demo file="verify/demo-sdk/examples/01-hello.ts" region="call"}
::listing[other-sdk]{#hello-other file="verify/other-sdk/examples/01-other.ts" region="call"}
:::
::::

Both tabs make the same call.

## Exercises`;

// The same box marked `top`: it stands at the chapter's top level, so its title is a level-2 heading and the tab
// headings are level 3.
const TOP_LEVEL = TABBED.replace("{#same-call}", "{#same-call top}");

// Position never makes a box top level: an untagged box that ends its section, and two boxes in a row before a ##
// heading, each keep the level they declare.
const ENDING = `## Alpha

Text.

:::box[Ends alpha]{#ends-alpha}
Body.
:::

## Beta

### Sub

Text.

:::box[Ends sub]{#ends-sub}
Body.
:::

## Exercises`;
const ROW = `## Alpha

Text.

:::box[First]{#first}
Body.
:::

:::box[Second top]{#second-top top}
Body.
:::

## Exercises`;
const rendered = (body: string) => {
  const d = mutatedFixture((copy) => edit(copy, "chapters/second.md", (text) => text.replace("## Exercises", body)));
  const out = renderLikeAstro(loadBook(fixtureInputs(d)), "second");
  return out.finally(() => removeFixture(d));
};
const endingHtml = await rendered(ENDING);
const rowHtml = await rendered(ROW);

const dir = mutatedFixture((copy) => edit(copy, "chapters/second.md", (text) => text.replace("## Exercises", BOX)));
const html = await renderLikeAstro(loadBook(fixtureInputs(dir)), "second");
const tabbedDir = mutatedFixture((copy) =>
  edit(copy, "chapters/second.md", (text) => text.replace("## Exercises", TABBED)),
);
const tabbedHtml = await renderLikeAstro(loadBook(fixtureInputs(tabbedDir)), "second");
const topDir = mutatedFixture((copy) =>
  edit(copy, "chapters/second.md", (text) => text.replace("## Exercises", TOP_LEVEL)),
);
const topHtml = await renderLikeAstro(loadBook(fixtureInputs(topDir)), "second");
afterAll(() => {
  removeFixture(dir);
  removeFixture(tabbedDir);
  removeFixture(topDir);
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
  assert.doesNotMatch(tabbedHtml, /<p>:::/, "every fence closes its own block");
});

test("a box marked top is at the top level: a level-2 title, and level-3 tab headings", () => {
  assert.match(topHtml, /<h2 class="box__heading" id="same-call">The same call in two harnesses<\/h2>/);
  assert.match(topHtml, /<h3 class="tabs__heading" id="lst-hello-demo-heading">demo-sdk<\/h3>/);
  assert.match(topHtml, /<h3 class="tabs__heading" id="lst-hello-other-heading">other-sdk<\/h3>/);
});

test("a box followed by more of its section stays inside it, one level below the section's heading", () => {
  assert.match(box, /<h3 class="box__heading" id="fixture-runs-offline">/);
});

test("an untagged box that ends a section stays a sub-heading, before a ## heading or after a ### one", () => {
  assert.match(endingHtml, /<h3 class="box__heading" id="ends-alpha">/);
  assert.match(endingHtml, /<h4 class="box__heading" id="ends-sub">/);
});

test("two boxes in a row keep their own declared levels: untagged one level down, top at level 2", () => {
  assert.match(rowHtml, /<h3 class="box__heading" id="first">/);
  assert.match(rowHtml, /<h2 class="box__heading" id="second-top">/);
});
