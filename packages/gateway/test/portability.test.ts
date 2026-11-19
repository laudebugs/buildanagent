import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const packagesRoot = fileURLToPath(new URL("../..", import.meta.url));

// The offline guards run only in our Node test process, so they may use Node APIs.
const nodeOnlyFiles = new Set(["testing/guards.ts", "testing/setup.ts"]);

// Each pattern names a Node-only API that would break the package on Cloudflare, AWS or Vercel edge targets.
const nodeOnlyApis: readonly [string, RegExp][] = [
  ["a node: import", /\bfrom\s*["']node:|\bimport\s*\(\s*["']node:/],
  ["Buffer", /\bBuffer\b/],
  ["process", /\bprocess\s*[.[]/],
  ["require", /\brequire\s*\(/],
  ["__dirname or __filename", /\b__(dirname|filename)\b/],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** Blanks out comments, so prose that mentions an API does not count as using it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function violations(): string[] {
  const packages = readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return packages.flatMap((pkg) => {
    const src = join(packagesRoot, pkg.name, "src");
    return sourceFiles(src)
      .filter((file) => !nodeOnlyFiles.has(relative(src, file).replaceAll("\\", "/")))
      .flatMap((file) => {
        const code = withoutComments(readFileSync(file, "utf8"));
        return nodeOnlyApis
          .filter(([, pattern]) => pattern.test(code))
          .map(([api]) => `${relative(packagesRoot, file)} uses ${api}`);
      });
  });
}

test("no package source outside the offline guards uses a Node-only API", () => {
  assert.deepEqual(violations(), []);
});
