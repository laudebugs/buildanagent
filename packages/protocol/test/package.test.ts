// What the published package may and may not depend on: its emitted JavaScript imports nothing outside the package, and
// it declares no dependency on the harness, so the workspace graph has no cycle.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, test } from "vitest";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as Record<
  string,
  Record<string, string> | undefined
>;
const out = mkdtempSync(join(tmpdir(), "protocol-dist-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

/** The nearest `node_modules/.bin/tsc` above the package, so no path to node_modules is written down. */
function findTsc(): string {
  for (let dir = packageDir; dirname(dir) !== dir; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", ".bin", "tsc");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("no tsc found above the package");
}

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

const SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
// An import whose specifier is not a string literal can't be checked, so it counts as outside the package.
const COMPUTED_IMPORT = /\bimport\s*\(\s*[^"'\s]/;
// Comments are removed first, so prose that says "from 'node:readline'" is not read as an import.
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

test("the emitted JavaScript imports nothing outside the package", () => {
  // The workspace packages it takes types from may not be built, so the build reads their source, as the tests do. The
  // environment is cleared, as for every spawned process, keeping only the folder of the running `node` on PATH.
  const env = {
    PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
    HOME: out,
    TMPDIR: out,
    LANG: "C.UTF-8",
  };
  execFileSync(findTsc(), ["-p", "tsconfig.build.json", "--outDir", out, "--customConditions", "source"], {
    cwd: packageDir,
    env,
    stdio: "pipe",
  });
  const files = jsFiles(out);
  assert.ok(files.length > 0, "the build wrote files");
  for (const file of files) {
    const code = withoutComments(readFileSync(file, "utf8"));
    assert.doesNotMatch(code, COMPUTED_IMPORT, `${file} has an import whose specifier can't be checked`);
    for (const match of code.matchAll(SPECIFIER)) {
      assert.match(match[1] as string, /^\.\.?\//, `${file} imports ${match[1]}, which is outside the package`);
    }
  }
}, 60_000);

test("the package declares no dependency on the harness", () => {
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    assert.ok(!Object.keys(manifest[field] ?? {}).includes("@buildanagent/harness"), `${field} names the harness`);
  }
});
