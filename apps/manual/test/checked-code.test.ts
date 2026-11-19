import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";
import type { WrittenChapter } from "../src/book/book-index.js";
import { checkBook } from "../src/book/check-book.js";
import { CodeNames, hasName } from "../src/book/code-names.js";
import { readFactCheckRows } from "../src/book/fact-check-log.js";
import { classifySpan, FILE_EXTENSIONS, markerAt, SHELL_COMMANDS } from "../src/book/inline-code.js";
import { listedFiles, loadBook, renderDependencies } from "../src/book/load.js";
import { cutRegion } from "../src/book/regions.js";
import {
  buildError,
  edit,
  fixtureInputs,
  prose,
  removeFixture,
  renderLikeAstro,
  resetFixture,
  withInteractive,
  withSdk,
} from "./book-fixture.js";

// The inline-code check (BK17): the span patterns and the marker, the fact-check rows a marker cites, the names the
// compiler reads from real listings, transcripts and .d.ts files, and fixture chapters that build. The fixtures that
// must fail are in check-book.test.ts, with every other rule's.

const dir = mkdtempSync(join(tmpdir(), "book-checked-code-"));
afterAll(() => removeFixture(dir));

test("identifiers and dotted member paths are checked by each name that is not a keyword", () => {
  assert.deepEqual(classifySpan("generateText"), { kind: "checked", names: ["generateText"] });
  assert.deepEqual(classifySpan("generateText()"), { kind: "checked", names: ["generateText"] });
  assert.deepEqual(classifySpan("result.steps"), { kind: "checked", names: ["result", "steps"] });
  assert.deepEqual(classifySpan("import.meta.resolve"), { kind: "checked", names: ["meta", "resolve"] });
  assert.deepEqual(classifySpan("$state"), { kind: "checked", names: ["$state"] });
});

test("file paths skip the check", () => {
  for (const span of ["src/index.ts", "verify/vercel-ai-sdk/examples/02-tool-loop.ts", "package.json", "AGENTS.md"]) {
    assert.deepEqual(classifySpan(span), { kind: "skipped", rule: "path" }, span);
  }
  assert.deepEqual(classifySpan(String.raw`C:\agent\run.ts`), { kind: "skipped", rule: "path" });
});

test("shell commands skip the check", () => {
  for (const span of ["pnpm", "pnpm test", "node --test scripts/ci/results-drift.test.mjs", "git commit -m fix"]) {
    assert.deepEqual(classifySpan(span), { kind: "skipped", rule: "command" }, span);
  }
});

test("numbers, quoted strings, keywords and plain values skip the check", () => {
  for (const span of ["42", "0.5", "-1", '"assistant"', "'stop'", "true", "null", "undefined", "async", "NaN"]) {
    assert.deepEqual(classifySpan(span), { kind: "skipped", rule: "value" }, span);
  }
});

test("a span that is neither identifier-like nor skipped is left unchecked", () => {
  for (const span of ["pass^k", "stopWhen: isStepCount(5)", "{ maxTurns: 10 }", "a b"]) {
    assert.deepEqual(classifySpan(span), { kind: "unchecked" }, span);
  }
});

test("the skip list stays short: adding a command or an extension changes this test, for review", () => {
  assert.deepEqual([...SHELL_COMMANDS].sort(), [
    "corepack",
    "curl",
    "gh",
    "git",
    "node",
    "npm",
    "npx",
    "pnpm",
    "tsc",
    "tsx",
    "wrangler",
  ]);
  assert.equal(FILE_EXTENSIONS.size, 20);
});

test("a marker cites a row by number, and anything else that starts like a marker is malformed", () => {
  assert.deepEqual(markerAt("{checked=row-12} caps the run"), { row: 12, length: 16 });
  for (const text of ["{checked=12}", "{checked=row-0}", "{ checked=row-1 }", "{checked}"]) {
    assert.ok(markerAt(text) !== undefined && "malformed" in (markerAt(text) ?? {}), text);
  }
  assert.equal(markerAt("{other} text"), undefined);
  assert.equal(markerAt(" {checked=row-1}"), undefined);
});

test("a fact-check log gives each row's verdict from its # and Verdict columns, and names repeated rows", () => {
  const rows = readFactCheckRows(
    [
      "| # | Claim | Where | Verdict | Source and reason |",
      "| --- | --- | --- | --- | --- |",
      "| 1 | The loop stops | § The loop | ✅ | docs |",
      "| 2 | A pipe \\| in a cell | § Tools | ✏️ corrected | docs |",
      "| 3 | Not yet checked | § Tools | ⚠️ | none |",
      "| 3 | Numbered twice | § Tools | ✅ | docs |",
      "| Total | | | 3 | |",
      "",
      "| # | Claim | Verdict | Source |",
      "| --- | --- | --- | --- |",
      "| 4 | A second table | ✅ (secondary) | blog |",
      "| 5 | No verdict | pending | |",
    ].join("\n"),
  );
  assert.deepEqual(
    [...rows.verdicts],
    [
      [1, "✅"],
      [2, "✏️"],
      [3, "⚠️"],
      [4, "✅"],
      [5, { other: "pending" }],
    ],
  );
  assert.deepEqual([...rows.repeated], [3]);
});

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** A written chapter whose one listing is a region of a real harness's example, as the book index would resolve it. */
function realListing(harness: string, path: string, region: string): WrittenChapter {
  const lines = cutRegion(readFileSync(join(REPO_ROOT, path), "utf8"), region);
  assert.ok(Array.isArray(lines), `${path} should have the region ${region}`);
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, harness, "package.json"), "utf8"));
  const chapter = { slug: "real", title: "Real", opening: "code", number: 1, part: 0 } as const;
  return {
    chapter: chapter as unknown as WrittenChapter["chapter"],
    file: join(REPO_ROOT, "real.md"),
    bodyLineOffset: 0,
    blocks: [
      {
        kind: "listing",
        id: "loop",
        chapter: chapter as unknown as WrittenChapter["chapter"],
        number: "1.1",
        line: 1,
        source: { path, region, lines, harness, pin: `ai@${pkg.dependencies.ai}`, lang: "typescript" },
      },
    ],
  };
}

test("a real AI SDK listing offers its region's names, its transcript's values and its packages' exports", () => {
  const code = new CodeNames(REPO_ROOT);
  const written = realListing("verify/vercel-ai-sdk", "verify/vercel-ai-sdk/examples/02-tool-loop.ts", "loop");
  const names = code.chapter(written);
  assert.ok(typeof names !== "string", String(names));
  assert.deepEqual(
    names.listings.map((source) => source.label),
    ["verify/vercel-ai-sdk/examples/02-tool-loop.ts#loop"],
  );
  const listed = names.listings[0]?.names ?? new Set();
  assert.ok(listed.has("stopWhen") && listed.has("isStepCount") && listed.has("Weather in Lisbon?"));
  // `weather` is a tool the tool region defines, outside the loop region; the transcript records it by name.
  assert.deepEqual(
    names.transcripts.map((source) => source.label),
    ["verify/vercel-ai-sdk/results/transcripts/02-tool-loop.json"],
  );
  assert.ok(names.transcripts[0]?.names.has("weather") && names.transcripts[0]?.names.has("assistant"));
  const labels = names.packages.map((source) => source.label);
  assert.ok(
    labels.some((label) => /^ai@\d/.test(label)) && labels.some((label) => /^zod@\d/.test(label)),
    labels.join(),
  );
  // `tool` reaches ai's entry through a re-export from @ai-sdk/provider-utils, which the checker follows.
  for (const name of ["generateText", "tool", "isStepCount", "z"]) assert.ok(hasName(names, name), name);
  assert.ok(!hasName(names, "maxBudgetUsd"));
  // Each chapter's names are worked out once per load.
  assert.equal(code.chapter(written), names);
});

test("identifiers from a listing, a transcript and a re-exported .d.ts build, and a cited ✅ or ✏️ row builds", async () => {
  resetFixture(dir, (copy) => {
    withSdk(copy);
    withInteractive(copy);
    edit(
      copy,
      "apps/manual/fact-checks/second.md",
      (text) =>
        `${text}\n| # | Claim | Where | Verdict | Source and reason |\n| --- | --- | --- | --- | --- |\n` +
        "| 1 | maxTurns caps the run | § Exercises | ✅ | agent.d.ts |\n" +
        "| 2 | internalHelper is internal | § Exercises | ✏️ | agent.d.ts |\n",
    );
    prose(
      copy,
      [
        "The listings name `greet`, `greeter`, `result.text` and `createAgent()`.",
        "The transcript names the `assistant` and the stop reason `stop`.",
        "The package also exports `defineTool` and `stepLimit`.",
        "By hand: `maxTurns`{checked=row-1} and `internalHelper`{checked=row-2}.",
        "Skipped: `package.json`, `src/index.ts`, `pnpm test`, `true` and `42`.",
      ].join(" "),
    );
  });
  const inputs = fixtureInputs(dir);
  assert.deepEqual(await checkBook(inputs), []);
  assert.equal(await buildError(inputs), undefined);
  const html = await renderLikeAstro(loadBook(inputs), "second");
  assert.match(html, /<code>maxTurns<\/code> and <code>internalHelper<\/code>\./);
  assert.doesNotMatch(html, /checked=row/);
});

test("a listing without replay still offers its example's transcript", async () => {
  resetFixture(dir, (copy) => {
    edit(copy, "chapters/second.md", (text) =>
      text.replace(
        /^(::listing\[Greeting.*)$/m,
        '$1\n\n::listing[The steps]{#steps file="verify/demo-sdk/examples/02-notes.ts" region="steps"}',
      ),
    );
    prose(copy, "The fake model answers as the `assistant`.");
  });
  assert.deepEqual(await checkBook(fixtureInputs(dir)), []);
});

test("a fact-check log joins the render dependencies and the files a dev server watches", () => {
  resetFixture(dir, withSdk);
  const book = loadBook(fixtureInputs(dir));
  const log = join(dir, "apps/manual/fact-checks/second.md");
  assert.ok(listedFiles(book).includes(log));
  const before = renderDependencies(book);
  edit(
    dir,
    "apps/manual/fact-checks/second.md",
    (text) => `${text}\n| # | Claim | Verdict |\n| --- | --- | --- |\n| 1 | A | ⚠️ |\n`,
  );
  assert.notEqual(renderDependencies(loadBook(fixtureInputs(dir))), before);
});
