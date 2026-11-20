import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CAPABILITIES } from "@buildanagent/sdk";
import { test } from "vitest";
import {
  checkPackage,
  codeBlocks,
  declarationExports,
  documentedNames,
  experimentalViolations,
  headingAnchors,
  missingNames,
  typecheckBlocks,
  // @ts-expect-error: the check script is plain JavaScript and ships no types.
} from "../../../scripts/package-docs.mjs";
// @ts-expect-error: the check script is plain JavaScript and ships no types.
import { CONFIG, PACKAGE_DIR } from "../scripts/docs-check.mjs";

type Entry = { specifier: string; exports: { name: string; doc?: string; from?: string }[] };

// One run of every check: it emits the declarations and type-checks the README's blocks, so it takes seconds.
const result = checkPackage(PACKAGE_DIR, CONFIG);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("every TypeScript block in the README type-checks, and every export name it documents exists", () => {
  assert.ok(result.blocks > 0);
  assert.deepEqual(result.problems, []);
});

test("llms.txt is built from this commit's README and declarations", () => {
  assert.equal(
    readFileSync(new URL("../llms.txt", import.meta.url), "utf8"),
    result.llms,
    "run `node packages/sdk/scripts/docs-check.mjs --write`",
  );
});

test("llms.txt lists every public export of every entry point, and every README section", { timeout: 60_000 }, () => {
  const entries: Entry[] = declarationExports(PACKAGE_DIR);
  assert.deepEqual(
    entries.map((entry) => entry.specifier),
    ["@buildanagent/sdk", "@buildanagent/sdk/otel", "@buildanagent/sdk/testing"],
  );
  for (const { specifier, exports } of entries) {
    const section = result.llms.split(`## Exports from \`${specifier}\``)[1]?.split("\n## ")[0] ?? "";
    for (const { name } of exports) assert.match(section, new RegExp(`\`(?:\\w+ )?${name}(?:\\(\\))?\``), name);
  }
  for (const { anchor } of headingAnchors(readme)) assert.ok(result.llms.includes(`(README.md#${anchor})`), anchor);
});

test("the README lists every string in CAPABILITIES, in order, and no other", () => {
  const section = readme.split("### `CAPABILITIES` tells a peer what it can rely on")[1]?.split("\n### ")[0] ?? "";
  const listed = [...section.matchAll(/^- \*\*`(\w+)`\*\*:/gm)].map((match) => match[1]);
  assert.deepEqual(listed, [...CAPABILITIES]);
});

test("a documented name the declarations lack fails the export diff, from prose and from an import", () => {
  const entries: Entry[] = [{ specifier: "@buildanagent/sdk", exports: [{ name: "run" }, { name: "SdkError" }] }];
  const markdown = [
    "Call `run()`, catch `SdkError`, and read `maxSteps`.",
    "Then call `startAgent()` and check `RunGone`.",
    "",
    "```ts",
    'import { run, walk } from "@buildanagent/sdk";',
    "```",
  ].join("\n");
  const problems: string[] = missingNames({ documented: documentedNames(markdown), entries });
  assert.deepEqual(problems, [
    "line 5: walk is imported from @buildanagent/sdk, which doesn't export it",
    "line 2: `startAgent` looks like an export, but no entry point exports it",
    "line 2: `RunGone` looks like an export, but no entry point exports it",
  ]);
  const allowed: string[] = missingNames({
    documented: documentedNames(markdown.split("\n").slice(0, 2).join("\n")),
    entries,
    notExports: { startAgent: "an example's function", RunGone: "a made-up name" },
  });
  assert.deepEqual(allowed, []);
});

test("a README block that no longer type-checks fails, with its README line", () => {
  const markdown = [
    "Intro.",
    "",
    "```ts",
    'import { run } from "@buildanagent/sdk";',
    "run({ model, system, input, maxSteps: '20' });",
    "```",
    "",
    "```ts",
    "this is not TypeScript",
    "```",
  ].join("\n");
  mkdirSync(path.join(PACKAGE_DIR, ".tmp"), { recursive: true });
  const dir = mkdtempSync(path.join(PACKAGE_DIR, ".tmp", "globals-"));
  try {
    const globals = path.join(dir, "globals.ts");
    writeFileSync(
      globals,
      'import type { Model } from "@buildanagent/gateway";\n' +
        "declare global {\n  const model: Model;\n  const system: string;\n  const input: string;\n}\n",
    );
    const blocks: { line: number; errors: string[] }[] = typecheckBlocks({
      packageDir: PACKAGE_DIR,
      blocks: codeBlocks(markdown),
      globals,
    });
    assert.deepEqual(
      blocks.map((block) => block.line),
      [3, 8],
    );
    assert.match(blocks[0]?.errors.join("\n") ?? "", /^line 5: TS2322 /);
    assert.match(blocks[1]?.errors.join("\n") ?? "", /^line 9: TS1\d{3} /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a public name's experimental_ prefix and @experimental tag must agree", () => {
  const entries: Entry[] = [
    {
      specifier: "@buildanagent/sdk",
      exports: [
        { name: "run", doc: "Starts a run." },
        { name: "experimental_fork", doc: "Forks a run.\n@experimental" },
        { name: "branch", doc: "Branches a run.\n@experimental" },
        { name: "experimental_merge", doc: "Merges two runs." },
        { name: "experimental_peer", from: "@buildanagent/gateway" },
      ],
    },
  ];
  assert.deepEqual(experimentalViolations(entries), [
    "@buildanagent/sdk: branch is marked @experimental but lacks the experimental_ prefix",
    "@buildanagent/sdk: experimental_merge has the experimental_ prefix but no @experimental tag",
  ]);
});
