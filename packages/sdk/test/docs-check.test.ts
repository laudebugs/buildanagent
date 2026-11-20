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
  exportsOf,
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
    "Then call `startAgent()` and check `RunGone`, `SDKGone` and `GONE`.",
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
    "line 2: `SDKGone` looks like an export, but no entry point exports it",
    "line 2: `GONE` looks like an export, but no entry point exports it",
  ]);
  const allowed: string[] = missingNames({
    documented: documentedNames(markdown.split("\n").slice(0, 2).join("\n")),
    entries,
    notExports: {
      startAgent: "an example's function",
      RunGone: "a made-up name",
      SDKGone: "a made-up name",
      GONE: "a made-up name",
    },
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

test("a tsc that fails without a diagnostic fails the README check instead of passing every block", () => {
  mkdirSync(path.join(PACKAGE_DIR, ".tmp"), { recursive: true });
  const dir = mkdtempSync(path.join(PACKAGE_DIR, ".tmp", "crash-"));
  try {
    const tsc = path.join(dir, "tsc.mjs");
    writeFileSync(tsc, 'console.error("Error: Debug Failure. False expression.");\nprocess.exit(1);\n');
    const globals = path.join(dir, "globals.ts");
    writeFileSync(globals, "export {};\n");
    assert.throws(
      () => typecheckBlocks({ packageDir: PACKAGE_DIR, blocks: codeBlocks("```ts\nconst a = 1;\n```"), globals, tsc }),
      /tsc failed without checking the README's blocks:\nError: Debug Failure/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tsc runs with an allowlisted environment, so no token reaches it", () => {
  mkdirSync(path.join(PACKAGE_DIR, ".tmp"), { recursive: true });
  const dir = mkdtempSync(path.join(PACKAGE_DIR, ".tmp", "env-"));
  const saved = process.env.DOCS_CHECK_SECRET;
  process.env.DOCS_CHECK_SECRET = "leaked";
  try {
    const tsc = path.join(dir, "tsc.mjs");
    // A stand-in that reports the variable as a block diagnostic, so the check's output shows what tsc saw.
    writeFileSync(
      tsc,
      [
        "const seen = process.env.DOCS_CHECK_SECRET ?? 'unset';",
        "console.log('block-1.ts(1,1): error TS9999: ' + seen + ' ' + Object.keys(process.env).sort().join(','));",
        "process.exit(2);",
      ].join("\n"),
    );
    const globals = path.join(dir, "globals.ts");
    writeFileSync(globals, "export {};\n");
    const [block] = typecheckBlocks({ packageDir: PACKAGE_DIR, blocks: codeBlocks("```ts\n1;\n```"), globals, tsc });
    assert.match(block?.errors[0] ?? "", /TS9999 unset HOME,LANG,PATH,TMPDIR$/);
  } finally {
    if (saved === undefined) delete process.env.DOCS_CHECK_SECRET;
    else process.env.DOCS_CHECK_SECRET = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an overloaded export keeps the doc of the overload that has one, so its @experimental tag is seen", () => {
  mkdirSync(path.join(PACKAGE_DIR, ".tmp"), { recursive: true });
  const dir = mkdtempSync(path.join(PACKAGE_DIR, ".tmp", "overloads-"));
  try {
    const file = path.join(dir, "index.d.ts");
    writeFileSync(
      file,
      [
        "/**",
        " * Forks a run.",
        " * @experimental",
        " */",
        "export declare function fork(a: string): void;",
        "export declare function fork(a: number): void;",
        "",
      ].join("\n"),
    );
    const exports: Entry["exports"] = exportsOf(file);
    assert.deepEqual(experimentalViolations([{ specifier: "@buildanagent/sdk", exports }]), [
      "@buildanagent/sdk: fork is marked @experimental but lacks the experimental_ prefix",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an exported const enum is listed under its own name, not as an export called enum", () => {
  mkdirSync(path.join(PACKAGE_DIR, ".tmp"), { recursive: true });
  const dir = mkdtempSync(path.join(PACKAGE_DIR, ".tmp", "const-enum-"));
  try {
    const file = path.join(dir, "index.d.ts");
    writeFileSync(file, "/** Run modes. */\nexport declare const enum Mode {\n  A = 0,\n}\n");
    const exports: Entry["exports"] = exportsOf(file);
    assert.deepEqual(
      exports.map((item) => item.name),
      ["Mode"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
