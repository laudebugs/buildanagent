// The AWS SDK is an optional peer of the harness: only the three AWS subpaths import it, each only its own client, and
// no other entry reaches one, so a host off AWS never installs it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  exports: Record<string, { source: string }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const AWS_ENTRIES: Record<string, string> = {
  "./aws/dynamodb": "@aws-sdk/client-dynamodb",
  "./aws/scheduler": "@aws-sdk/client-scheduler",
  "./aws/secrets-manager": "@aws-sdk/client-secrets-manager",
};

/** The bare specifiers every file reachable from `entry` through relative imports imports, type-only ones included. */
function bareImports(entry: string): Set<string> {
  const bare = new Set<string>();
  const seen = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const [, spec] of code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (spec?.startsWith(".")) pending.push(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
      else if (spec !== undefined) bare.add(spec);
    }
  }
  return bare;
}

const awsOf = (specs: Set<string>) => [...specs].filter((spec) => spec.startsWith("@aws-sdk/")).sort();

test("each AWS subpath imports its own AWS SDK client and no other", () => {
  for (const [entry, client] of Object.entries(AWS_ENTRIES)) {
    const source = join(root, manifest.exports[entry]?.source ?? "");
    assert.deepEqual(awsOf(bareImports(source)), [client], relative(root, source));
  }
});

test("no other entry point reaches the AWS SDK", () => {
  const offenders = Object.entries(manifest.exports)
    .filter(([entry]) => !(entry in AWS_ENTRIES))
    .flatMap(([entry, { source }]) => awsOf(bareImports(join(root, source))).map((spec) => `${entry} imports ${spec}`));
  assert.deepEqual(offenders, []);
});

test("the AWS SDK clients are optional peers pinned to the release the tests run, never dependencies", () => {
  for (const client of Object.values(AWS_ENTRIES)) {
    assert.equal(manifest.dependencies[client], undefined, client);
    assert.equal(manifest.peerDependencies?.[client], manifest.devDependencies[client], client);
    assert.equal(manifest.peerDependenciesMeta?.[client]?.optional, true, client);
  }
});
