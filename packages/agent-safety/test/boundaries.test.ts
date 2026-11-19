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

test("the root entry imports nothing but the gateway and its own files", () => {
  const bare = [...reachable(join(packageRoot, "src", "index.ts")).values()].flat();
  assert.deepEqual(
    bare.filter((spec) => !spec.startsWith("@buildanagent/gateway")),
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

test("the ai subpath imports third-party SDKs for types only", () => {
  const valueImports = [...reachable(join(packageRoot, "src", "ai", "index.ts")).keys()].flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)]
      .map((match) => match[1] ?? "")
      .filter((spec) => THIRD_PARTY.test(spec)),
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
