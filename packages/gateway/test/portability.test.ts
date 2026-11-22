import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const packagesRoot = fileURLToPath(new URL("../..", import.meta.url));

// The offline guards run only in our Node test process, so they may use Node APIs. The mock server opens a socket,
// which needs Node's `http` module; it imports it only when a test starts a server, so the export loads everywhere.
const nodeOnlyFiles = new Set([
  // The CLI binary reads the process arguments and writes to standard output, so it is Node-only by nature.
  "bin.ts",
  "testing/guards.ts",
  "testing/setup.ts",
  "testing/mock-server.ts",
  // The harness's `none` sandbox runs a local process and `spawnEnv()` reads the parent's environment, so both are
  // Node-only by nature. They load Node's modules with `process.getBuiltinModule()` when called, so importing the
  // sandbox entry still works on every target.
  "sandbox/none.ts",
  "sandbox/spawn-env.ts",
  // The process runner and the host file calls that the backends share, and the `srt` and Docker backends, run local
  // processes and read `/proc`, so they are Node-only by nature too. They load Node's modules the same way, and each
  // backend has its own entry, such as `@buildanagent/harness/sandbox/srt`, which the portable `./sandbox` entry
  // never imports.
  "sandbox/process.ts",
  "sandbox/host-files.ts",
  "sandbox/base.ts",
  "sandbox/srt/index.ts",
  "sandbox/docker/index.ts",
  // The egress proxy listens on a local socket and resolves names, so it is Node-only by nature. It has its own entry,
  // `@buildanagent/harness/credentials`, whose scrubber and address check are portable.
  "credentials/egress-proxy.ts",
  // The harness's JSONL session store and file lock keep sessions, locks and pointers in files, so they are Node-only by
  // nature. They have their own entry, `@buildanagent/harness/session/jsonl`, and the portable `./session` entry
  // never imports them.
  "session/jsonl-store.ts",
  "session/file-lock.ts",
  "session/file-index.ts",
  // The approval key ring is a file with a mode, so it is Node-only too, and has the same entry.
  "session/file-key-store.ts",
  // The file spill store writes each capped tool result to a file, so it is Node-only too. It has its own entry,
  // `@buildanagent/harness/context/file`, and the portable `./context` entry never imports it.
  "context/file-spill.ts",
  // The extension loader, the trust file and the lock file read and write files and import modules, so they are
  // Node-only. They have their own entry, `@buildanagent/harness/extensions/node`, and the portable `./extensions`
  // entry never imports them.
  "extensions/load.ts",
  "extensions/lock.ts",
  "extensions/trust-file.ts",
]);

// Each pattern names a Node-only API that would break the package on Cloudflare, AWS or Vercel edge targets.
const nodeOnlyApis: readonly [string, RegExp][] = [
  ["a node: import", /\b(from|import)\s*\(?\s*["']node:/],
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

/**
 * Blanks out comments, so prose that mentions an API does not count as using it. A line comment must start a line or
 * follow whitespace, which keeps `//` inside a string or URL from hiding the code after it; a string holding ` //` can
 * still hide the rest of its line, which Biome's `noRestrictedGlobals` covers for the globals.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function violations(): string[] {
  const packages = readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return packages.flatMap((pkg) => {
    const src = join(packagesRoot, pkg.name, "src");
    // A new package may be scaffolded before it has any source.
    if (!existsSync(src)) return [];
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
