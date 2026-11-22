import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";
import type { WrittenChapter } from "../src/book/book-index.js";
import { checkBook } from "../src/book/check-book.js";
import { CodeNames, hasName } from "../src/book/code-names.js";
import { readFactCheckRows } from "../src/book/fact-check-log.js";
import { classifySpan, FILE_EXTENSIONS, LITERAL_VALUES, markerAt, SHELL_COMMANDS } from "../src/book/inline-code.js";
import { checkedCodeFiles, loadBook, renderDependencies } from "../src/book/load.js";
import { cutRegion } from "../src/book/regions.js";
import {
  buildError,
  edit,
  fixtureInputs,
  prose,
  removeFixture,
  renderLikeAstro,
  resetFixture,
  SECOND_LOG,
  withInteractive,
  withRows,
  withSdk,
} from "./book-fixture.js";

// The inline-code check (BK17): the span patterns and the marker, the fact-check rows a marker cites, the names the
// compiler reads from real listings, transcripts and .d.ts files, and fixture chapters that build. The fixtures that
// must fail are in check-book.test.ts, with every other rule's.

const dir = mkdtempSync(join(tmpdir(), "book-checked-code-"));
// The tests that load a book or a real package's .d.ts files run tsc and the compiler; on a loaded machine they need
// more than Vitest's default 5 seconds. A time limit, not a timing assertion.
const SLOW = { timeout: 60_000 };
afterAll(() => removeFixture(dir));

test("identifiers and member paths are checked by every name, a property's name whatever it spells", () => {
  assert.deepEqual(classifySpan("generateText"), { kind: "checked", names: ["generateText"], paths: [] });
  assert.deepEqual(classifySpan("generateText()"), { kind: "checked", names: ["generateText"], paths: [] });
  assert.deepEqual(classifySpan("result.steps"), {
    kind: "checked",
    names: ["result", "steps"],
    paths: [["result", "steps"]],
  });
  assert.deepEqual(classifySpan("result.object"), {
    kind: "checked",
    names: ["result", "object"],
    paths: [["result", "object"]],
  });
  assert.deepEqual(classifySpan("part.type"), { kind: "checked", names: ["part", "type"], paths: [["part", "type"]] });
  assert.deepEqual(classifySpan("import.meta.resolve"), {
    kind: "checked",
    names: ["meta", "resolve"],
    paths: [["meta", "resolve"]],
  });
  assert.deepEqual(classifySpan("$state"), { kind: "checked", names: ["$state"], paths: [] });
});

test("contextual keywords are checked like names, and a reserved word alone is not code", () => {
  for (const span of ["type", "object", "async", "string"]) {
    assert.deepEqual(classifySpan(span), { kind: "checked", names: [span], paths: [] }, span);
  }
  for (const span of ["const", "return", "this", "await"]) assert.deepEqual(classifySpan(span), { kind: "unchecked" });
});

test("code that parses is checked by each identifier in it, and strings and numbers are left out", () => {
  assert.deepEqual(classifySpan("stopWhen: isStepCount(5)"), {
    kind: "checked",
    names: ["stopWhen", "isStepCount"],
    paths: [],
  });
  assert.deepEqual(classifySpan("zzz(1)"), { kind: "checked", names: ["zzz"], paths: [] });
  assert.deepEqual(classifySpan("maxBudgetUsd: 1"), { kind: "checked", names: ["maxBudgetUsd"], paths: [] });
  assert.deepEqual(classifySpan("{ maxTurns: 10 }"), { kind: "checked", names: ["maxTurns"], paths: [] });
  assert.deepEqual(classifySpan('tool({ description: "Get the weather", input: undefined })'), {
    kind: "checked",
    names: ["tool", "description", "input"],
    paths: [],
  });
  // A trailing () makes a member path code, so a method named like an extension is checked, not taken for a file.
  assert.deepEqual(classifySpan("response.json()"), {
    kind: "checked",
    names: ["response", "json"],
    paths: [["response", "json"]],
  });
  // Assignments, logical and nullish operators, typeof and as are code, not notation.
  for (const [span, names] of [
    ["maxTurns = 10", ["maxTurns"]],
    ["retries++", ["retries"]],
    ["!done", ["done"]],
    ["a && b", ["a", "b"]],
    ["a ?? b", ["a", "b"]],
    ["typeof x", ["x"]],
    ["foo as Bar", ["foo", "Bar"]],
  ] as const) {
    assert.deepEqual(classifySpan(span), { kind: "checked", names, paths: [] }, span);
  }
  // A template literal with a substitution is code; the member path inside it is kept for the standard library.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the inline code is a template literal with a substitution.
  assert.deepEqual(classifySpan("`hi ${user.name}`"), {
    kind: "checked",
    names: ["user", "name"],
    paths: [["user", "name"]],
  });
  assert.deepEqual(classifySpan("JSON.parse(text)"), {
    kind: "checked",
    names: ["JSON", "parse", "text"],
    paths: [["JSON", "parse"]],
  });
});

test("a span that is not code, or does not parse, is left unchecked", () => {
  for (const span of ["pass^k", "n - 1", "(a + b) / 2", "2 ** k", "tool-calls", "a b", "[[fig:nope]]", "[@nope]"]) {
    assert.deepEqual(classifySpan(span), { kind: "unchecked" }, span);
  }
});

test("file paths skip the check", () => {
  for (const span of [
    "src/index.ts",
    "verify/vercel-ai-sdk/examples/02-tool-loop.ts",
    "package.json",
    "tsconfig.base.json",
    "AGENTS.md",
  ]) {
    assert.deepEqual(classifySpan(span), { kind: "skipped", rule: "path" }, span);
  }
  assert.deepEqual(classifySpan(String.raw`C:\agent\run.ts`), { kind: "skipped", rule: "path" });
});

test("shell commands skip the check", () => {
  for (const span of ["pnpm", "pnpm test", "node --test scripts/ci/results-drift.test.mjs", "git commit -m fix"]) {
    assert.deepEqual(classifySpan(span), { kind: "skipped", rule: "command" }, span);
  }
});

test("numbers, quoted strings and literal values skip the check", () => {
  for (const span of ["42", "0.5", "-1", "1e3", '"assistant"', "'stop'", "`plain`", "true", "undefined", "NaN"]) {
    assert.deepEqual(classifySpan(span), { kind: "skipped", rule: "value" }, span);
  }
});

test("the skip list stays short: adding a command, an extension or a value changes this test, for review", () => {
  assert.deepEqual([...SHELL_COMMANDS].sort(), ["git", "node", "npm", "npx", "pnpm", "tsc", "tsx"]);
  assert.deepEqual(
    [...FILE_EXTENSIONS].sort(),
    ["cjs", "css", "cts", "html", "js", "json", "jsonc", "jsx", "md", "mdx"]
      .concat(["mjs", "mts", "sh", "svg", "toml", "ts", "tsx", "txt", "yaml", "yml"])
      .sort(),
  );
  assert.deepEqual([...LITERAL_VALUES].sort(), ["Infinity", "NaN", "false", "null", "true", "undefined"]);
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
  const pin = `ai@${pkg.dependencies.ai}`;
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
        source: { path, region, lines, harness, pin, recordedPin: pin, lang: "typescript" },
      },
    ],
  };
}

test("a real AI SDK listing offers its region's names, its transcript's values and its packages' exports", SLOW, () => {
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
  // A third-party listing reaches none of our packages' source, so it adds no render input.
  assert.deepEqual(code.workspaceSources([written]), []);
});

test("a listing on our SDK reads its exports from source, and that source joins the render inputs", SLOW, () => {
  const code = new CodeNames(REPO_ROOT);
  const written = realListing("packages/sdk", "packages/sdk/examples/03-tool-loop.ts", "tool");
  const names = code.chapter(written);
  assert.ok(typeof names !== "string", String(names));
  for (const name of ["defineTool", "run", "z"]) assert.ok(hasName(names, name), name);
  const sources = code.workspaceSources([written]);
  assert.ok(sources.includes(join(REPO_ROOT, "packages/sdk/src/run.ts")), "the SDK's source is a render input");
  assert.ok(sources.includes(join(REPO_ROOT, "packages/gateway/src/complete.ts")), "so is the gateway's");
});

test(
  "a real harness's standard library resolves ECMAScript and Node.js globals, but no environment variable",
  SLOW,
  () => {
    const code = new CodeNames(REPO_ROOT);
    const written = realListing("verify/vercel-ai-sdk", "verify/vercel-ai-sdk/examples/02-tool-loop.ts", "loop");
    const [library] = code.libraries(written);
    assert.ok(library !== undefined);
    assert.equal(library.label, "verify/vercel-ai-sdk/tsconfig.json (lib es2024; types node)");
    for (const name of ["Promise", "JSON", "fetch", "process", "Buffer"]) assert.ok(library.has(name), name);
    for (const name of ["document", "window", "OPENAI_API_KEY"]) assert.ok(!library.has(name), name);
    assert.equal(library.resolvedPrefix(["JSON", "parse"]), 2);
    assert.equal(library.resolvedPrefix(["Promise", "resolve"]), 2);
    // ProcessEnv's index signature names no property, so an environment variable needs a listing or a marker.
    assert.equal(library.resolvedPrefix(["process", "env", "OPENAI_API_KEY"]), 2);
    assert.equal(library.resolvedPrefix(["result", "text"]), 0);
    assert.equal(code.libraries(written), code.libraries(written));
  },
);

test(
  "names from a listing, a transcript and a re-exported .d.ts build, and so does a cited ✅ or ✏️ row",
  SLOW,
  async () => {
    resetFixture(dir, (copy) => {
      withSdk(copy);
      withInteractive(copy);
      withRows(copy);
      prose(
        copy,
        [
          'The listings name `greet`, `greeter`, `result.text`, `createAgent()` and `agent.run("Hi")`.',
          "A listing's keywords count too: `string`.",
          "The transcript names the `assistant` and the stop reason `stop`.",
          "The package also exports `defineTool` and `stepLimit`.",
          "The standard library declares `Promise`, `JSON.parse` and `Array.from()`.",
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
  },
);

test("a listing without replay still offers its example's transcript", SLOW, async () => {
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

test("logs and transcripts join the files astro.config.mjs hashes, and package versions the dependencies", SLOW, () => {
  resetFixture(dir, (copy) => {
    withSdk(copy);
    edit(copy, "chapters/second.md", (text) =>
      text.replace(
        /^(::listing\[Greeting.*)$/m,
        '$1\n\n::listing[The steps]{#steps file="verify/demo-sdk/examples/02-notes.ts" region="steps"}',
      ),
    );
  });
  const book = loadBook(fixtureInputs(dir));
  assert.deepEqual(
    checkedCodeFiles(book).map((file) => relative(dir, file)),
    [
      SECOND_LOG.replace("second", "first"),
      SECOND_LOG,
      "verify/demo-sdk/results/transcripts/02-notes.json",
      "verify/demo-sdk/tsconfig.json",
    ],
  );
  assert.match(renderDependencies(book), /"packages":\["demo-sdk@1\.2\.3"\]/);
  const before = renderDependencies(book);
  edit(dir, "verify/demo-sdk/node_modules/demo-sdk/package.json", (text) => text.replace("1.2.3", "1.2.4"));
  assert.notEqual(renderDependencies(loadBook(fixtureInputs(dir))), before);
});
