// Which entry may reach a hosted sandbox SDK. `@vercel/sandbox` is an optional peer: only `./sandbox/vercel` imports it
// by value, so every other entry loads in an install that lacks it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports: Record<string, { source: string }>;
};

// The SDKs of hosted sandboxes, which only their own subpath may import by value.
const OPTIONAL_PEERS = ["@vercel/sandbox"];
const PEER = /^@vercel\/sandbox(\/|$)/;

// Value imports, value re-exports, side-effect imports and dynamic imports. A type-only import is erased at build.
const VALUE_IMPORT =
  /^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gm;

function valueImports(code: string): string[] {
  return [...code.matchAll(VALUE_IMPORT)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

/** Every source file reachable from `entry` through relative value imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(readFileSync(file, "utf8")).filter((s) => s.startsWith("."))) {
      pending.push(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
    }
  }
  return [...seen];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("the value-import check catches re-exports, side-effect and dynamic imports, and skips type-only ones", () => {
  const code = [
    'import type { A } from "@vercel/sandbox";',
    'export type { B } from "@vercel/sandbox";',
    'import { Sandbox } from "@vercel/sandbox";',
    'export { Sandbox } from "@vercel/sandbox";',
    'import "@vercel/sandbox";',
    'const m = await import("@vercel/sandbox");',
  ].join("\n");
  assert.deepEqual(valueImports(code), Array(4).fill("@vercel/sandbox"));
});

test("only the Vercel sandbox's client file imports @vercel/sandbox by value", () => {
  const importers = sourceFiles(join(packageRoot, "src"))
    .filter((file) => valueImports(readFileSync(file, "utf8")).some((spec) => PEER.test(spec)))
    .map((file) => relative(join(packageRoot, "src"), file));
  assert.deepEqual(importers, ["sandbox/vercel/sdk.ts"]);
});

test("no entry but ./sandbox/vercel reaches @vercel/sandbox", () => {
  const reaching = Object.entries(manifest.exports)
    .filter(([, entry]) =>
      reachable(join(packageRoot, entry.source)).some((file) =>
        valueImports(readFileSync(file, "utf8")).some((spec) => PEER.test(spec)),
      ),
    )
    .map(([name]) => name);
  assert.deepEqual(reaching, ["./sandbox/vercel"]);
});

test("the hosted sandbox SDKs are optional peers, never dependencies", () => {
  assert.deepEqual(Object.keys(manifest.peerDependencies ?? {}).sort(), OPTIONAL_PEERS);
  for (const peer of OPTIONAL_PEERS) {
    assert.equal(manifest.peerDependenciesMeta?.[peer]?.optional, true, peer);
    assert.equal(manifest.dependencies?.[peer], undefined, peer);
  }
});
