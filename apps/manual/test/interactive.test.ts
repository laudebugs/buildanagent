import assert from "node:assert/strict";
import { join } from "node:path";
import { afterAll, test } from "vitest";
import { listedFiles, loadBook, renderDependencies } from "../src/book/load.js";
import { cutRegion } from "../src/book/regions.js";
import { replayEvents, type Transcript } from "../src/book/transcripts.js";
import {
  edit,
  fixtureInputs,
  mutatedFixture,
  removeFixture,
  renderLikeAstro,
  withInteractive,
} from "./book-fixture.js";

// The fixture's interactive listings, rendered as the build renders them. A page's HTML before any script runs is
// what a reader without JavaScript sees, so these tests read that HTML. check-book.test.ts holds one failing fixture
// per rule for notes, tabs and replays, and page-scripts.test.ts runs the scripts.

const dir = mutatedFixture(withInteractive);
const book = loadBook(fixtureInputs(dir));
const html = await renderLikeAstro(book, "second");
afterAll(() => removeFixture(dir));

const between = (from: string, to: string): string =>
  html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const noted = between('<figure id="lst-noted"', "</figure>");

test("a listing with three notes shows three numbered markers on their lines, without the marker comments", () => {
  const markers = [
    ...noted.matchAll(/<a class="annotation-marker" href="#lst-noted-note-([a-z-]+)" aria-label="Note (\d)">\2<\/a>/g),
  ];
  assert.deepEqual(
    markers.map((m) => [m[1], m[2]]),
    [
      ["name", "1"],
      ["greet", "2"],
      ["print", "3"],
    ],
  );
  assert.equal((noted.match(/class="line line--highlight"/g) ?? []).length, 3, "each annotated line is highlighted");
  assert.doesNotMatch(noted, /book:note/);
});

test("without JavaScript the notes are a numbered list of three under the code, the markers' targets", () => {
  const list = between('<ol class="annotations"', "</ol>");
  assert.match(list, /aria-label="Notes on this listing"/);
  assert.deepEqual(
    [...list.matchAll(/<li id="lst-noted-note-([a-z-]+)">/g)].map((m) => m[1]),
    ["name", "greet", "print"],
  );
  assert.ok(noted.indexOf("</pre>") < noted.indexOf('<ol class="annotations"'), "the list follows the code");
  assert.match(list, /The second greets them with <a href="\/second\/#lst-greet" class="xref">Listing 2\.2<\/a>\./);
});

test("a tabs block with listings from two harnesses shows two panels, two paths and two pins", () => {
  const tabs = between('<div class="tabs" data-label="SDK">', '<h2 id="exercises"');
  assert.deepEqual(
    [...tabs.matchAll(/<section class="tabs__panel" id="([^"]+)"><h2 class="tabs__heading"[^>]*>([^<]+)<\/h2>/g)].map(
      (m) => [m[1], m[2]],
    ),
    [
      ["lst-hello-demo-panel", "demo-sdk"],
      ["lst-hello-other-panel", "other-sdk"],
    ],
  );
  assert.deepEqual(
    [...tabs.matchAll(/<span class="listing__path">([^<]+)<\/span>/g)].map((m) => m[1]),
    ["verify/demo-sdk/examples/01-hello.ts", "verify/other-sdk/examples/01-other.ts"],
  );
  assert.deepEqual(
    [...tabs.matchAll(/<span class="listing__pin">([^<]+)<\/span>/g)].map((m) => m[1]),
    ["demo-sdk@1.2.3", "other-sdk@4.5.6"],
  );
  assert.deepEqual(
    [...tabs.matchAll(/<span class="listing__number number">([^<]+)<\/span>/g)].map((m) => m[1]),
    ["Listing 2.4", "Listing 2.5"],
  );
  assert.doesNotMatch(tabs, /listing__title/, "the tab's heading is the caption, so the caption does not repeat it");
  assert.match(tabs, /<figure id="lst-hello-demo"[^>]*aria-labelledby="lst-hello-demo-heading lst-hello-demo-caption"/);
});

test("a tab heading sits one level below the heading the tabs follow", async () => {
  const nested = mutatedFixture((copy) => {
    withInteractive(copy);
    edit(copy, "chapters/second.md", (text) => text.replace(":::tabs\n", "## Two SDKs\n\n:::tabs\n"));
  });
  const page = await renderLikeAstro(loadBook(fixtureInputs(nested)), "second");
  removeFixture(nested);
  assert.deepEqual(
    [...page.matchAll(/<(h\d) class="tabs__heading"/g)].map((m) => m[1]),
    ["h3", "h3"],
  );
});

test("without JavaScript a replay lists every event and says where each came from", () => {
  const replay = between('<section class="replay panel" id="lst-noted-replay"', "</section>");
  assert.match(replay, /data-steps="cumulative"[^>]* data-listing="lst-noted"/);
  assert.match(
    replay,
    /<span class="label panel__label replay__source"><span class="replay__segment">verify\/<\/span><span class="replay__segment">demo-sdk\/<\/span><span class="replay__segment">results\/<\/span><span class="replay__segment">transcripts\/<\/span><span class="replay__segment">02-notes\.json<\/span><\/span>/,
    "the transcript's path may wrap after a slash, never inside a name",
  );
  assert.match(
    replay,
    /<div class="replay__scroll" tabindex="0" role="group" aria-label="Events of Recorded run of Listing 2\.3" data-step-scroll(?:="")?><ol class="replay__events">/,
    "the events scroll in a region the keyboard reaches and a screen reader names",
  );
  const events = [
    ...replay.matchAll(
      /<li class="replay__event" data-kind="(\w+)" data-step="\d+"(?: data-line="(\d+)")?><span class="replay__role">([^<]+)<\/span><p class="replay__body">([^<]*)<span class="replay__where">([^<]+)<\/span><\/p>/g,
    ),
  ];
  assert.deepEqual(
    events.map((m) => [m[1], m[2], m[3], m[4], m[5]]),
    [
      ["user", "6", "System", "Be brief.", "line 6"],
      ["user", "6", "User", "Greet the reader.", "line 6"],
      ["tool", "6", "Tool call", 'greet({"name":"reader"})', "line 6"],
      ["result", "6", "Tool result", "greet: Hello, reader.", "line 6"],
      ["model", undefined, "Model", "Hello, reader.", "no source line"],
      ["check", "7", "Check", "the greeting reaches the reader", "line 7"],
      ["check", undefined, "Check", "greet is defined", "line 2, outside this listing"],
    ],
  );
  assert.match(replay, /<div class="controls"[^>]*aria-label="Replay of Listing 2\.3"[^>]* hidden>/);
  assert.match(html, /<div class="listing-replay"><figure id="lst-noted"/, "the replay follows its listing");
});

test("a replay leaves out the model's answer when the next request resends it, and empty text", () => {
  const transcript: Transcript = {
    format: 1,
    example: "x",
    file: "x.ts",
    harness: "verify/x",
    pin: "x@1.0.0",
    mock: "x@1.0.0",
    events: [
      {
        kind: "request",
        model: "model-1",
        repeated: 0,
        messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        tools: [],
      },
      {
        kind: "response",
        model: "model-1",
        message: {
          role: "assistant",
          parts: [
            { type: "text", text: "" },
            { type: "tool-call", id: "c", name: "t", input: {} },
          ],
        },
        finish: "tool-calls",
      },
      {
        kind: "request",
        model: "model-1",
        repeated: 1,
        messages: [
          { role: "assistant", parts: [{ type: "tool-call", id: "c", name: "t", input: {} }] },
          { role: "tool", parts: [{ type: "tool-result", id: "c", name: "t", output: { ok: false }, error: true }] },
        ],
        tools: [],
      },
      { kind: "check", line: 9, message: "it failed", pass: false },
    ],
  };
  assert.deepEqual(replayEvents(transcript), [
    { kind: "user", role: "User", body: "Hi" },
    { kind: "tool", role: "Tool call", body: "t({})" },
    { kind: "user", role: "History", body: "1 earlier message sent again" },
    { kind: "result", role: "Tool error", body: 't: {"ok":false}' },
    { kind: "check", role: "Check failed", body: "it failed", line: 9 },
  ]);
});

test("a replay folds history another agent resends, names unknown parts and shortens long bodies", () => {
  const user = { role: "user" as const, parts: [{ type: "text" as const, text: "Where is my refund?" }] };
  const transcript: Transcript = {
    format: 1,
    example: "x",
    file: "x.ts",
    harness: "verify/x",
    pin: "x@1.0.0",
    mock: "x@1.0.0",
    events: [
      { kind: "request", model: "model-1", repeated: 0, messages: [user], tools: [] },
      {
        kind: "request",
        model: "model-1",
        repeated: 0,
        messages: [
          { role: "system", parts: [{ type: "other", kind: "sections", value: ["preamble", "tools"] }] },
          user,
          { role: "user", parts: [{ type: "text", text: "x".repeat(700) }] },
        ],
        tools: [],
      },
      {
        kind: "response",
        model: "model-1",
        message: {
          role: "assistant",
          parts: [
            { type: "other", kind: "derived-text", value: { characters: 42 } },
            { type: "other", kind: "image", value: { url: "a.png" } },
          ],
        },
        finish: "stop",
      },
    ],
  };
  assert.deepEqual(
    replayEvents(transcript).map(({ role, body }) => [role, body]),
    [
      ["User", "Where is my refund?"],
      ["History", "1 earlier message sent again"],
      ["System prompt sections", "preamble, tools"],
      ["User", `${"x".repeat(600)}… (100 more characters)`],
      [
        "Model text (made up by the fake model)",
        "42 characters that the fake model built from the conversation so far",
      ],
      ["Other part (image)", '{"url":"a.png"}'],
    ],
  );
});

test("note markers come off their lines, and a listing keeps each line's note id", () => {
  const lines = cutRegion("a(); // book:note first\n  b();   //   book:note second  \nc();\n", undefined);
  assert.deepEqual(lines, [
    { number: 1, text: "a();", note: "first" },
    { number: 2, text: "  b();", note: "second" },
    { number: 3, text: "c();" },
  ]);
});

test("a listing that gives no notes shows its marked lines plainly", async () => {
  const plain = mutatedFixture((copy) => {
    withInteractive(copy);
    edit(copy, "chapters/second.md", (text) => text.replace(/^::note.*\n/gm, ""));
  });
  const page = await renderLikeAstro(loadBook(fixtureInputs(plain)), "second");
  removeFixture(plain);
  const figure = page.slice(page.indexOf('<figure id="lst-noted"'));
  assert.doesNotMatch(figure.slice(0, figure.indexOf("</figure>")), /annotation|book:note|line--highlight/);
});

test("a transcript joins the render dependencies and the files a dev server watches", () => {
  assert.ok(listedFiles(book).includes(join(dir, "verify/demo-sdk/results/transcripts/02-notes.json")));
  const before = renderDependencies(book);
  edit(dir, "verify/demo-sdk/results/transcripts/02-notes.json", (text) => text.replace("Be brief.", "Be terse."));
  assert.notEqual(renderDependencies(loadBook(fixtureInputs(dir))), before);
});
