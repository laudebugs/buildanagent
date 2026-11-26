import assert from "node:assert/strict";
import { test } from "vitest";
import { codeOf, exampleSource, exampleTitle, parseExampleRef, rewriteMeta } from "../src/plugins/example-code.js";

test("a fence's meta names the file and the region", () => {
  assert.deepEqual(parseExampleRef('file="packages/sdk/examples/a.ts" region="run"'), {
    file: "packages/sdk/examples/a.ts",
    region: "run",
  });
  assert.deepEqual(parseExampleRef('file="packages/sdk/examples/a.ts"'), { file: "packages/sdk/examples/a.ts" });
  assert.equal(parseExampleRef(""), undefined);
  assert.equal(parseExampleRef(null), undefined);
});

test("a region comes out without its markers or its indent, and the title is the file's name", () => {
  const code = exampleSource({ file: "packages/sdk/examples/order-agent.ts", region: "run" });
  assert.match(code, /^const started = run\(\{/);
  assert.ok(!code.includes("#region") && !code.includes("#endregion"));
  assert.equal(exampleTitle({ file: "packages/sdk/examples/order-agent.ts" }), "order-agent.ts");
});

test("another reader's notes on an example line are left out", () => {
  const code = exampleSource({ file: "packages/sdk/examples/01-one-call.ts", region: "call" });
  assert.ok(code.length > 0 && !code.includes("book:note"));
});

test("a file outside an examples folder, a path that climbs out and a missing region are refused", () => {
  assert.throws(() => exampleSource({ file: "packages/sdk/src/index.ts" }), /not a file under/);
  assert.throws(() => exampleSource({ file: "packages/sdk/examples/../src/index.ts" }), /not a file under/);
  assert.throws(
    () => exampleSource({ file: "packages/sdk/examples/order-agent.ts", region: "nope" }),
    /no region named nope/,
  );
});

test("a region that holds another region is refused, because the first end marker would cut it short", () => {
  const text =
    "// #region outer\nconst a = 1;\n// #region inner\nconst b = 2;\n// #endregion\nconst c = 3;\n// #endregion\n";
  assert.throws(() => codeOf(text, { file: "a.ts", region: "outer" }), /holds another region/);
  assert.equal(codeOf(text, { file: "a.ts", region: "inner" }), "const b = 2;");
});

test("a region that holds no code is refused", () => {
  assert.throws(() => codeOf("// #region empty\n// #endregion\n", { file: "a.ts", region: "empty" }), /holds no code/);
});

test("a fence keeps its other attributes, and gets the file's name as its title unless it has one", () => {
  const ref = { file: "packages/sdk/examples/a.ts", region: "run" };
  assert.equal(rewriteMeta('file="packages/sdk/examples/a.ts" region="run" {2-3}', ref), '{2-3} title="a.ts"');
  assert.equal(rewriteMeta('file="packages/sdk/examples/a.ts" title="Mine"', ref), 'title="Mine"');
});

test("a transcript fence is read like an example file but gets no title", () => {
  const ref = { file: "packages/cli/transcripts/help.txt" };
  assert.match(exampleSource(ref), /^\$ buildanagent --help\n/);
  assert.equal(rewriteMeta('file="packages/cli/transcripts/help.txt"', ref), "");
  assert.throws(() => exampleSource({ file: "packages/cli/transcripts/../src/bin.ts" }), /not a file under/);
  assert.throws(() => exampleSource({ file: "packages/cli/transcripts/a/b.txt" }), /not a file under/);
});
