import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { listingContext, resolveListing } from "../src/book/listings.js";
import { loadBook, renderDependencies } from "../src/book/load.js";
import { ProblemList } from "../src/book/problems.js";
import { inWorkspace, tscProjects } from "../src/book/typecheck-coverage.js";
import { highlightListing } from "../src/markdown/highlight.js";
import {
  edit,
  FIXTURE_DIR,
  FIXTURE_OUTLINE,
  fixtureInputs,
  mutatedFixture,
  removeFixture,
  renderLikeAstro,
} from "./book-fixture.js";

// The fixture's second chapter lists the region "greet" of verify/demo-sdk/examples/01-hello.ts. These tests read
// what the build makes of it; check-book.test.ts holds one failing fixture per listing rule.

const book = loadBook(fixtureInputs());
const second = await renderLikeAstro(book, "second");
const context = listingContext(FIXTURE_DIR, join(FIXTURE_DIR, "harnesses.json"), "harnesses.json", new ProblemList());
const EXAMPLE = "verify/demo-sdk/examples/01-hello.ts";

function listingOf(region?: string) {
  const listing = resolveListing({ id: "x", file: EXAMPLE, ...(region ? { region } : {}) }, context);
  assert.ok(!("message" in listing), "message" in listing ? listing.message : "");
  return listing;
}

test("a listing shows its number, its path, its line range and the pin read from the harness's package.json", () => {
  const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, "verify/demo-sdk/package.json"), "utf8"));
  const pin = `demo-sdk@${manifest.dependencies["demo-sdk"]}`;
  assert.equal(pin, "demo-sdk@1.2.3");
  assert.ok(
    second.includes(
      '<figcaption class="listing__caption" id="lst-greet-caption"><span class="listing__number number">Listing 2.2</span>' +
        '<span class="listing__title">Greeting the reader</span>' +
        `<span class="listing__path">${EXAMPLE}</span><span class="listing__lines">lines 3–7</span>` +
        `<span class="listing__pin">${pin}</span></figcaption>`,
    ),
    second,
  );
  assert.match(
    second,
    /<figure id="lst-greet" class="numbered listing panel"[^>]*aria-labelledby="lst-greet-caption">/,
  );
  assert.match(second, /<pre class="listing__code" tabindex="0" aria-label="Code of listing 2\.2"><code>/);
});

test("a listing written in the chapter goes through the file listings' highlighter and panel, with no path or pin", async () => {
  const dir = mutatedFixture((fixture) =>
    edit(fixture, "chapters/second.md", (text) =>
      text.replace(
        "## Exercises",
        ':::listing[A request body]{#body}\n```json\n{\n  "role": "user"\n}\n```\n:::\n\n## Exercises',
      ),
    ),
  );
  try {
    const html = await renderLikeAstro(loadBook(fixtureInputs(dir)), "second");
    const figure = html.slice(
      html.indexOf('<figure id="lst-body"'),
      html.indexOf("</figure>", html.indexOf("lst-body")),
    );
    assert.match(figure, /<pre class="listing__code" tabindex="0" aria-label="Code of listing 2\.\d+"><code>/);
    assert.match(figure, /<span class="line" data-line="2"><span class="line__number" aria-hidden="true">2<\/span>/);
    assert.match(figure, /<span class="tok-keyword">"role"<\/span>: <span class="tok-string">"user"<\/span>/);
    assert.doesNotMatch(figure, /listing__path|listing__pin|listing__lines/);
  } finally {
    removeFixture(dir);
  }
});

test("a listing's lines keep their numbers in the file and lose the markers of regions nested in them", () => {
  // The fixture's chapter also holds an inline listing, which numbers its lines from 1; this test reads the file's.
  const fileListing = second.slice(second.indexOf('<figure id="lst-greet"'));
  const numbers = [...fileListing.matchAll(/<span class="line__number" aria-hidden="true">(\d+)<\/span>/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(numbers, ["3", "5", "7"]);
  assert.doesNotMatch(second, /#(end)?region/);
});

test("Shiki highlights the listing into the panel's token classes, with no colour of its own", () => {
  assert.match(second, /<span class="tok-keyword">export<\/span> <span class="tok-keyword">function<\/span> greet/);
  assert.match(second, /<span class="tok-string">`Hello, <\/span>/);
  assert.doesNotMatch(second.slice(second.indexOf('id="lst-greet"')), /style=/);
});

test("a region cut from inside a block loses the block's indentation", () => {
  assert.deepEqual(listingOf("call").lines, [
    { number: 12, text: 'const greeting = greet("reader");' },
    { number: 13, text: "console.log(greeting);" },
  ]);
  const [message, ...rest] = listingOf("message").lines;
  assert.equal(rest.length, 0);
  assert.equal(message?.number, 5);
  assert.match(message?.text ?? "", /^return `Hello, /);
});

test("a listing without a region shows the whole file without its markers", () => {
  const { lines } = listingOf();
  assert.equal(lines[0]?.number, 1);
  assert.equal(lines.at(-1)?.number, 15);
  assert.ok(lines.every((line) => !line.text.includes("#region") && !line.text.includes("#endregion")));
});

test("comment lines highlight as comments", async () => {
  const lines = await highlightListing(listingOf());
  assert.deepEqual(
    lines[0]?.tokens.map((token) => token.kind),
    ["comment"],
  );
});

test("moving a chapter in the outline renumbers its file listings", async () => {
  const [partA, partB] = FIXTURE_OUTLINE;
  const [one, two] = partA?.chapters ?? [];
  const [three] = partB?.chapters ?? [];
  assert.ok(partA && partB && one && two && three);
  // The planned third chapter moves to the front and `second` to Part B, so `second` becomes Chapter 3.
  const moved = loadBook(
    fixtureInputs(undefined, [
      { ...partA, chapters: [three, one] },
      { ...partB, chapters: [two] },
    ]),
  );
  assert.match(await renderLikeAstro(moved, "second"), /<span class="listing__number number">Listing 3\.2<\/span>/);
});

test("a new pin or a changed listed line changes the render dependencies, so the content cache clears", () => {
  for (const change of [
    (dir: string) => edit(dir, "verify/demo-sdk/package.json", (t) => t.replace('"1.2.3"', '"1.2.4"')),
    (dir: string) => edit(dir, EXAMPLE, (t) => t.replace("Hello,", "Hi,")),
  ]) {
    const dir = mutatedFixture(change);
    try {
      assert.notEqual(renderDependencies(loadBook(fixtureInputs(dir))), renderDependencies(book));
    } finally {
      removeFixture(dir);
    }
  }
});

test("the typecheck script's tsc commands name the tsconfig files the coverage check reads", () => {
  assert.deepEqual(tscProjects("tsc -p tsconfig.json"), ["tsconfig.json"]);
  assert.deepEqual(tscProjects("tsc --project config/tsconfig.app.json && tsc -p test"), [
    "config/tsconfig.app.json",
    "test/tsconfig.json",
  ]);
  assert.deepEqual(tscProjects("tsc"), ["tsconfig.json"]);
  assert.deepEqual(tscProjects("node scripts/check.mjs"), []);
});

test("a workspace package matches a pnpm-workspace.yaml glob and no ! glob", () => {
  assert.ok(inWorkspace("verify/pi", ["apps/*", "verify/*"]));
  assert.ok(!inWorkspace("verify/pi", ["apps/*"]));
  assert.ok(!inWorkspace("verify/pi", ["verify/*", "!verify/pi"]));
  assert.ok(inWorkspace("verify/langchain", ["verify/*", "!verify/pi"]));
  assert.ok(!inWorkspace("verify/pi", ["./verify/*", "!./verify/pi"]));
});

// The real harnesses: every region marked in a verify/ example resolves, with the pin its harness's package.json
// holds, so a chapter can list any of them.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const real = listingContext(
  repoRoot,
  fileURLToPath(new URL("../src/data/harnesses.json", import.meta.url)),
  "harnesses.json",
  new ProblemList(),
);

test("the harness table names every verify/ harness and a main package its package.json pins", () => {
  const harnesses = readdirSync(join(repoRoot, "verify"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `verify/${entry.name}`);
  assert.deepEqual([...real.harnesses.harnesses.keys()].sort(), harnesses.sort());
  for (const [harness, name] of real.harnesses.harnesses) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, harness, "package.json"), "utf8"));
    assert.match(manifest.dependencies?.[name] ?? "", /^\d+\.\d+\.\d+$/, `${harness} pins ${name} exactly`);
  }
});

// Slow by design: the first listing in each harness runs that harness's real `tsc -p <config> --listFilesOnly` to
// check that its typecheck covers the file. The test takes about 2 seconds on an idle machine, and it ran past
// Vitest's 5-second default under the parallel `pnpm test`, so this one test gets 30 seconds.
test("every region marked in a verify/ example resolves to a listing with its harness's pin", {
  timeout: 30_000,
}, () => {
  let regions = 0;
  for (const harness of real.harnesses.harnesses.keys()) {
    const dir = join(repoRoot, harness, "examples");
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"))) {
      const path = `${harness}/examples/${file}`;
      const text = readFileSync(join(repoRoot, path), "utf8");
      for (const [, region] of text.matchAll(/^\s*\/\/\s*#region\s+(\S+)/gm)) {
        const listing = resolveListing({ id: "x", file: path, region }, real);
        assert.ok(!("message" in listing), "message" in listing ? listing.message : "");
        const manifest = JSON.parse(readFileSync(join(repoRoot, harness, "package.json"), "utf8"));
        const name = real.harnesses.harnesses.get(harness) ?? "";
        assert.equal(listing.pin, `${name}@${manifest.dependencies[name]}`);
        regions++;
      }
    }
  }
  assert.ok(regions > 0, "the verify/ examples mark regions");
});
