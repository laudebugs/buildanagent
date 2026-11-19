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
};

// The third-party SDKs only the subpaths may import.
const THIRD_PARTY = /^(ai|agents|@ai-sdk\/[^/]+)(\/|$)/;
// `agents` joins them with the first adapter in ./agents; listed before then, pnpm would install it as a peer.
const OPTIONAL_PEERS = ["@ai-sdk/provider-utils", "ai"];

function specifiers(file: string): string[] {
  const code = readFileSync(file, "utf8");
  return [...code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1] ?? "");
}

/** Every source file reachable from `entry` through relative imports, with the bare specifiers each one imports. */
function reachable(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const pending = [entry];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    const imports = specifiers(file);
    seen.set(
      file,
      imports.filter((spec) => !spec.startsWith(".")),
    );
    for (const spec of imports.filter((s) => s.startsWith("."))) {
      pending.push(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
    }
  }
  return seen;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "fixtures" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("nothing reachable from the root entry imports ai, @ai-sdk/* or agents", () => {
  const offenders = [...reachable(join(packageRoot, "src", "index.ts"))].flatMap(([file, bare]) =>
    bare.filter((spec) => THIRD_PARTY.test(spec)).map((spec) => `${relative(packageRoot, file)} imports ${spec}`),
  );
  assert.deepEqual(offenders, []);
});

test("the root entry imports nothing but its own files and declared dependencies", () => {
  // A devDependency such as the gateway would pass in this workspace and fail in a consumer's install.
  const declared = Object.keys(manifest.dependencies ?? {});
  const bare = [...reachable(join(packageRoot, "src", "index.ts")).values()].flat();
  assert.deepEqual(
    bare.filter((spec) => !declared.some((name) => spec === name || spec.startsWith(`${name}/`))),
    [],
  );
});

test("the ai subpath imports no Cloudflare agents code", () => {
  const bare = [...reachable(join(packageRoot, "src", "ai", "index.ts")).values()].flat();
  assert.deepEqual(
    bare.filter((spec) => /^agents(\/|$)/.test(spec)),
    [],
  );
});

// Value imports, value re-exports (`export { x } from`, `export * from`), side-effect imports and dynamic imports.
const VALUE_IMPORT =
  /^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gm;

function thirdPartyValueImports(code: string): string[] {
  return [...code.matchAll(VALUE_IMPORT)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((spec) => THIRD_PARTY.test(spec));
}

test("the value-import check catches re-exports, side-effect and dynamic imports, and skips type-only ones", () => {
  const code = [
    'import type { A } from "ai";',
    'export type { B } from "@ai-sdk/provider-utils";',
    'import { tool } from "ai";',
    'export { generateText } from "ai";',
    'export * from "@ai-sdk/provider-utils";',
    'import "agents";',
    'const m = await import("ai/test");',
  ].join("\n");
  assert.deepEqual(thirdPartyValueImports(code), ["ai", "ai", "@ai-sdk/provider-utils", "agents", "ai/test"]);
});

test("the ai subpath imports third-party SDKs for types only", () => {
  const valueImports = [...reachable(join(packageRoot, "src", "ai", "index.ts")).keys()].flatMap((file) =>
    thirdPartyValueImports(readFileSync(file, "utf8")),
  );
  assert.deepEqual(valueImports, []);
});

test("the third-party SDKs are optional peers, never dependencies", () => {
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(Object.keys(manifest.peerDependencies ?? {}).sort(), OPTIONAL_PEERS);
  for (const peer of OPTIONAL_PEERS) assert.equal(manifest.peerDependenciesMeta?.[peer]?.optional, true, peer);
});

test("no source or test file imports a relative path with a .ts extension", () => {
  // tsconfig.json allows `.ts` specifiers for a third-party package's sake, so this keeps our own files on `.js`.
  const offenders = [...sourceFiles(join(packageRoot, "src")), ...sourceFiles(join(packageRoot, "test"))].flatMap(
    (file) =>
      specifiers(file)
        .filter((spec) => spec.startsWith(".") && spec.endsWith(".ts"))
        .map((spec) => `${relative(packageRoot, file)} imports ${spec}`),
  );
  assert.deepEqual(offenders, []);
});
