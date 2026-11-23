import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, inject, test } from "vitest";
import { checkApiDocs, listExports } from "../src/api/check.js";
import {
  API_PACKAGES,
  CHECKED_PACKAGES,
  REQUIRED_TO_BE_DOCUMENTED,
  typeDocOptions,
  VALIDATION,
} from "../src/api/packages.js";

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

  for (const pkg of CHECKED_PACKAGES) {
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
  // test/built-site.ts builds the docs once for every file that reads built pages.
  const out = inject("builtSite");

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
