import assert from "node:assert/strict";
import { test } from "vitest";
import { exampleSource, exampleTitle, parseExampleRef } from "../src/plugins/example-code.js";

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
