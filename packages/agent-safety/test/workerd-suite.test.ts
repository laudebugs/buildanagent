import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vitest";
import { startWorker, type TestWorker } from "./miniflare.js";
import type { TestResult } from "./workerd/mini-vitest.js";

// The package's tests run in workerd as well as in Node 22 (E7). Vitest can't run inside workerd, so the Worker in
// workerd/portable-suite.ts loads the portable test files with a small runner standing in for "vitest" and runs every
// test in them. A file stays Node-only when it needs a Node API or a Node-side server: the files below say which, and
// the test after the run fails when a file is in neither list, so a new test file has to choose.
const here = fileURLToPath(new URL(".", import.meta.url));
const ENTRY = fileURLToPath(new URL("./workerd/portable-suite.ts", import.meta.url));
const RUNNER = fileURLToPath(new URL("./workerd/mini-vitest.ts", import.meta.url));

/** The test files that stay in Node, each with its reason. */
const NODE_ONLY: Record<string, string> = {
  "boundaries.test.ts": "reads the package's files and manifest from disk",
  "byok.test.ts": "stubs environment variables and starts loopback servers",
  "cloudflare-approval.test.ts": "starts workerd through Miniflare itself",
  "cloudflare-cost-guard.test.ts": "starts workerd through Miniflare itself",
  "cloudflare-interrupted.test.ts": "starts workerd through Miniflare itself",
  "crash.test.ts": "forks child processes and kills them",
  "cross-process.test.ts": "forks child processes",
  "docs-check.test.ts": "reads the README and runs the TypeScript compiler as a child process",
  "hash-realm.test.ts": "makes a second realm with node:vm, which workerd does not implement",
  "problem-messages.test.ts": "reads the docs page that quotes its messages",
  "outcomes.test.ts": "reads fixture files from disk",
  "signing.test.ts": "reads files and uses Node's process APIs",
  "stores/cloudflare.test.ts": "starts workerd through Miniflare itself",
  "stores/dynamodb.test.ts": "drives the AWS SDK's Node HTTP client",
  "stores/postgres.test.ts": "runs PGlite, which loads its WebAssembly from disk",
  "workerd-suite.test.ts": "is this test",
};

function testFiles(dir = here, base = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return entry.name === "workerd" || entry.name === "fixtures"
        ? []
        : testFiles(`${dir}${entry.name}/`, `${base}${entry.name}/`);
    return entry.name.endsWith(".test.ts") ? [`${base}${entry.name}`] : [];
  });
}

// The entry imports each file as `.js`, as every import here does; esbuild finds the `.ts` beside it.
const inSuite = [...readFileSync(ENTRY, "utf8").matchAll(/import "\.\.\/([^"]+)\.test\.js";/g)].map(
  (match) => `${match[1]}.test.ts`,
);

let worker: TestWorker | undefined;
let results: TestResult[] = [];

beforeAll(async () => {
  worker = await startWorker(ENTRY, [], {}, { vitest: RUNNER });
  const response = await worker.dispatch("/");
  const body = await response.text();
  assert.equal(response.status, 200, body);
  results = JSON.parse(body) as TestResult[];
}, 120_000);

afterAll(async () => {
  const blocked = worker?.blocked ?? [];
  await worker?.dispose();
  assert.deepEqual(blocked, [], "the Worker tried to reach the network");
});

test("every test file runs in workerd or says why it stays in Node", () => {
  const files = testFiles();
  const unplaced = files.filter((file) => !inSuite.includes(file) && NODE_ONLY[file] === undefined);
  assert.deepEqual(unplaced, [], "add each file to workerd/portable-suite.ts, or to NODE_ONLY with a reason");
  const both = files.filter((file) => inSuite.includes(file) && NODE_ONLY[file] !== undefined);
  assert.deepEqual(both, [], "a file can't be both in the suite and Node-only");
  const gone = Object.keys(NODE_ONLY).filter((file) => !files.includes(file));
  assert.deepEqual(gone, [], "NODE_ONLY names a file that no longer exists");
});

test("the portable tests all pass in workerd", () => {
  assert.ok(results.length > 150, `only ${results.length} tests ran in workerd`);
  const failed = results.filter((result) => result.error !== undefined);
  assert.deepEqual(
    failed.map((result) => `${result.name}: ${result.error?.split("\n")[0]}`),
    [],
  );
});
