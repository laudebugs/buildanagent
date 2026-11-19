import "@buildanagent/gateway/testing/setup";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("no gateway source file imports from @buildanagent/sdk", () => {
  const offenders = sourceFiles(join(packageRoot, "src")).filter((file) =>
    readFileSync(file, "utf8").includes("@buildanagent/sdk"),
  );
  assert.deepEqual(offenders, []);
});

test("the gateway package has no runtime dependencies", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.dependencies, undefined);
});
