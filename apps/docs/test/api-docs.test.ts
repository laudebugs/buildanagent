import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, test } from "vitest";
import { checkApiDocs, listExports } from "../src/api/check.js";
import { API_PACKAGES, REQUIRED_TO_BE_DOCUMENTED, typeDocOptions, VALIDATION } from "../src/api/packages.js";

const APP = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name: string) => join(APP, "test/fixtures/api", name);
const options = (entry: string) => ({ entryPoints: [fixture(entry)], tsconfig: fixture("tsconfig.json") });

// The undocumented-export check and the reference it guards. TypeDoc reads each package's sources, which takes a few
// seconds, so these tests get more than the default 5.
describe("the undocumented-export check", { timeout: 120_000 }, () => {
  test("passes a module whose export has TSDoc", async () => {
    assert.deepEqual((await checkApiDocs({ ...options("documented.ts"), ...fixtureRules() })).problems, []);
  });

  test("fails a module whose exported function has no TSDoc, and names it", async () => {
    const { problems } = await checkApiDocs({ ...options("undocumented.ts"), ...fixtureRules() });
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /subtract .*does not have any documentation/);
  });

  for (const pkg of API_PACKAGES) {
    test(`passes every entry point of ${pkg.name}`, async () => {
      assert.deepEqual((await checkApiDocs(typeDocOptions(pkg))).problems, []);
    });
  }
});

/** The same rules the packages are held to, for a fixture that has no `exports` map. */
function fixtureRules() {
  return { validation: VALIDATION, requiredToBeDocumented: [...REQUIRED_TO_BE_DOCUMENTED] };
}

describe("the built reference", { timeout: 180_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "docs-build-"));

  function nearestBin(name: string): string {
    for (let dir = APP; dir !== dirname(dir); dir = dirname(dir)) {
      const bin = join(dir, "node_modules", ".bin", name);
      if (existsSync(bin)) return bin;
    }
    throw new Error(`no node_modules/.bin/${name} above ${APP}`);
  }

  beforeAll(async () => {
    const home = mkdtempSync(join(tmpdir(), "docs-home-"));
    // An allowlisted environment, never ...process.env (AGENTS.md), with Astro's telemetry off so the build stays offline.
    const env = {
      PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
      HOME: home,
      TMPDIR: tmpdir(),
      LANG: process.env.LANG ?? "C.UTF-8",
      ASTRO_TELEMETRY_DISABLED: "1",
    };
    await promisify(execFile)(nearestBin("astro"), ["build", "--outDir", out], { cwd: APP, env });
    rmSync(home, { recursive: true, force: true });
  }, 180_000);

  afterAll(() => rmSync(out, { recursive: true, force: true }));

  const FOLDER: Record<string, string> = {
    Function: "functions",
    Class: "classes",
    Interface: "interfaces",
    TypeAlias: "type-aliases",
    Variable: "variables",
    Enum: "enumerations",
    Namespace: "namespaces",
  };

  for (const pkg of API_PACKAGES) {
    test(`has a page for every export of ${pkg.name}`, async () => {
      const exports = await listExports(typeDocOptions(pkg));
      assert.ok(exports.length > 20, "the package has exports");
      const missing = exports.filter((entry) => {
        // A module is named for its import path, and Astro drops the leading @ from a page's address.
        const folder = FOLDER[entry.kind];
        if (folder === undefined) return true;
        return !existsSync(
          join(
            out,
            pkg.output,
            entry.module.replace(/^@/, "").toLowerCase(),
            folder,
            entry.name.toLowerCase(),
            "index.html",
          ),
        );
      });
      assert.deepEqual(
        missing.map((entry) => `${entry.module}/${entry.name} (${entry.kind})`),
        [],
      );
    });
  }
});
