import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, test } from "vitest";
import { extendsChain, manualTsc, TypecheckCoverage } from "../src/book/typecheck-coverage.js";
import { edit, mutatedFixture, removeFixture } from "./book-fixture.js";

// The coverage check runs tsc, so these tests use copies of the fixture harness whose tsconfig.json carries a comment
// no other copy has: the shared program cache cannot answer for them, and each test sees tsc run or fail.

const EXAMPLE = "verify/demo-sdk/examples/01-hello.ts";
const CONFIG = "verify/demo-sdk/tsconfig.json";
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A fixture copy whose harness tsconfig is unlike any other copy's. */
function freshHarness(): string {
  const dir = mutatedFixture((copy) => edit(copy, CONFIG, (text) => `// ${randomUUID()}\n${text}`));
  dirs.push(dir);
  return dir;
}

/** A stand-in for tsc: a shell script that logs each run and then runs `body`. */
function fakeTsc(body: string): { readonly path: string; readonly runs: () => number } {
  const dir = mkdtempSync(join(tmpdir(), "fake-tsc-"));
  dirs.push(dir);
  const log = join(dir, "runs.log");
  const path = join(dir, "tsc");
  writeFileSync(path, `#!/bin/sh\necho run >> "${log}"\n${body}\n`);
  chmodSync(path, 0o755);
  return { path, runs: () => readFileSync(log, "utf8").split("\n").filter(Boolean).length };
}

const coverage = (dir: string, tsc?: string) =>
  new TypecheckCoverage(dir, ["verify/*"], tsc === undefined ? {} : { tsc });

test("the manual's own tsc is the one the coverage check runs", () => {
  const tsc = manualTsc();
  assert.ok(tsc?.endsWith(join("apps", "manual", "node_modules", ".bin", "tsc")), String(tsc));
});

test("a missing tsc is one message, not a crash", () => {
  const dir = freshHarness();
  assert.match(
    coverage(dir, join(dir, "no-such-tsc")).uncovered(join(dir, EXAMPLE)) ?? "",
    /: cannot run tsc to list verify\/demo-sdk\/tsconfig\.json: apps\/manual\/node_modules\/\.bin\/tsc is missing; run pnpm install$/,
  );
});

test("a tsc that fails names its first line of output", () => {
  const dir = freshHarness();
  const tsc = fakeTsc('echo "error TS5083: Cannot read file tsconfig.base.json." >&2\nexit 1');
  assert.match(
    coverage(dir, tsc.path).uncovered(join(dir, EXAMPLE)) ?? "",
    /: tsc -p verify\/demo-sdk\/tsconfig\.json --listFilesOnly failed: error TS5083: Cannot read file/,
  );
});

test("two loads of one tsconfig chain share one tsc run", () => {
  const dir = freshHarness();
  const real = manualTsc() ?? "";
  const tsc = fakeTsc(`exec "${real}" "$@"`);
  assert.equal(coverage(dir, tsc.path).uncovered(join(dir, EXAMPLE)), undefined);
  assert.equal(coverage(dir, tsc.path).uncovered(join(dir, EXAMPLE)), undefined);
  assert.equal(tsc.runs(), 1);
});

test("a changed tsconfig runs tsc again, and a file added since the last run is found", () => {
  const dir = freshHarness();
  assert.equal(coverage(dir).uncovered(join(dir, EXAMPLE)), undefined);
  writeFileSync(join(dir, "verify/demo-sdk/examples/02-added.ts"), "export const added = 1;\n");
  assert.equal(coverage(dir).uncovered(join(dir, "verify/demo-sdk/examples/02-added.ts")), undefined);
  edit(dir, CONFIG, (text) => text.replace('"include"', '"exclude": ["examples/01-hello.ts"],\n  "include"'));
  assert.match(
    coverage(dir).uncovered(join(dir, EXAMPLE)) ?? "",
    /verify\/demo-sdk\/tsconfig\.json does not include it$/,
  );
  assert.ok(!dir.includes(`${sep}node_modules${sep}`));
  removeFixture(dir);
});

/** A repository of two harnesses with identical tsconfig files; `files` adds each harness's other files. */
function twoHarnesses(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "two-harnesses-"));
  dirs.push(dir);
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("pnpm-workspace.yaml", 'packages:\n  - "verify/*"\n');
  for (const harness of ["a", "b"]) {
    write(`verify/${harness}/package.json`, '{ "scripts": { "typecheck": "tsc -p tsconfig.json" } }\n');
    write(
      `verify/${harness}/tsconfig.json`,
      '{ "extends": "../shared/tsconfig.base.json", "include": ["examples/**/*.ts"] }\n',
    );
    write(`verify/${harness}/lib/y.ts`, "export const y = 1;\n");
  }
  write("verify/shared/tsconfig.base.json", '{ "compilerOptions": { "strict": true } }\n');
  for (const [path, text] of Object.entries(files)) write(path, text);
  return dir;
}

test("a file only one harness imports is covered there, not in a harness with an identical tsconfig", () => {
  const dir = twoHarnesses({
    "verify/a/examples/x.ts": 'import { y } from "../lib/y";\nexport const x = y;\n',
    "verify/b/examples/x.ts": "export const x = 1;\n",
  });
  const check = coverage(dir);
  assert.equal(check.uncovered(join(dir, "verify/a/lib/y.ts")), undefined);
  assert.match(check.uncovered(join(dir, "verify/b/lib/y.ts")) ?? "", /verify\/b\/tsconfig\.json does not include it$/);
});

test("the key follows extends to a sibling base config, so editing it lists the program again", () => {
  const dir = twoHarnesses({ "verify/a/examples/x.ts": "export const x = 1;\n" });
  const example = join(dir, "verify/a/examples/x.ts");
  assert.ok(extendsChain(join(dir, "verify/a/tsconfig.json")).some((file) => file.endsWith("tsconfig.base.json")));
  assert.equal(coverage(dir).uncovered(example), undefined);
  // The harness's own tsconfig sets include but not exclude, so the base's exclude applies, resolved from the base's
  // own directory.
  writeFileSync(join(dir, "verify/shared/tsconfig.base.json"), '{ "exclude": ["../a/examples/x.ts"] }\n');
  assert.match(coverage(dir).uncovered(example) ?? "", /verify\/a\/tsconfig\.json does not include it$/);
});
