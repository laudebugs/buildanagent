import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "vitest";
import { DOCS_DIR } from "../src/plugins/pages.js";
import {
  describeRule,
  installLines,
  installProblems,
  installRuleFor,
  textOfHtml,
} from "../src/version/install-lines.js";
import { SDK_VERSION } from "../src/version/version.js";
import { builtSite } from "./built.js";

// While only alphas exist, every install line names @alpha; once the SDK is stable, none does. The pure functions come
// first, with fixtures for both states, then the same rule runs over every docs source page and every built page.
// Package READMEs have their own checks in their packages' tests.

describe("the rule follows the SDK's version", () => {
  test("a version with an -alpha. part means only alphas exist", () => {
    assert.equal(installRuleFor("0.1.0-alpha.34"), "alpha");
    assert.equal(installRuleFor("0.1.0-alpha.0"), "alpha");
  });
  test("a stable version, a beta and a release candidate switch to the stable rule", () => {
    assert.equal(installRuleFor("0.1.0"), "stable");
    assert.equal(installRuleFor("1.0.0"), "stable");
    assert.equal(installRuleFor("0.2.0-beta.1"), "stable");
    assert.equal(installRuleFor("1.0.0-rc.1"), "stable");
  });
});

describe("in the alpha state", () => {
  test("accepts lines whose every package ends in @alpha, in a multi-package line too", () => {
    const text = [
      "pnpm add @buildanagent/sdk@alpha @buildanagent/gateway@alpha zod",
      "npm install @buildanagent/sdk@alpha",
      "npm i @buildanagent/gateway@alpha",
      "yarn add @buildanagent/cli@alpha",
      "npx @buildanagent/cli@alpha init",
      "pnpm dlx @buildanagent/cli@alpha init",
    ].join("\n");
    assert.equal(installLines(text).length, 6);
    assert.deepEqual(installProblems(text, "alpha"), []);
  });

  test("catches a line without @alpha: the fixture the test exists for", () => {
    const [problem] = installProblems("pnpm add @buildanagent/sdk zod", "alpha");
    assert.equal(problem?.token, "@buildanagent/sdk");
  });

  test("catches the one untagged package in a multi-package line", () => {
    const problems = installProblems("pnpm add @buildanagent/sdk@alpha @buildanagent/gateway zod", "alpha");
    assert.deepEqual(
      problems.map((problem) => problem.token),
      ["@buildanagent/gateway"],
    );
  });

  test("catches every package manager and a wrong tag or a pinned version", () => {
    for (const line of [
      "npm install @buildanagent/sdk",
      "npm i @buildanagent/sdk",
      "yarn add @buildanagent/sdk",
      "npx @buildanagent/cli init",
      "pnpm dlx @buildanagent/cli",
      "pnpm add @buildanagent/sdk@latest",
      "pnpm add @buildanagent/sdk@0.1.0-alpha.3",
    ]) {
      assert.equal(installProblems(line, "alpha").length, 1, line);
    }
  });

  test("finds a command inside prose and inside a tab, as MDX writes them", () => {
    const mdx = [
      '<Tabs syncKey="pm">',
      '  <TabItem label="pnpm">',
      "  ```bash",
      "  pnpm add @buildanagent/sdk zod",
      "  ```",
      "  </TabItem>",
      "</Tabs>",
      "Run `npm install @buildanagent/sdk@alpha` first, then `yarn add @buildanagent/gateway`.",
    ].join("\n");
    assert.deepEqual(
      installProblems(mdx, "alpha").map((problem) => problem.token),
      ["@buildanagent/sdk", "@buildanagent/gateway"],
    );
  });

  test("ignores a package named in prose, an import and a subpath, because none installs anything", () => {
    const text = [
      "The `@buildanagent/sdk` package runs the loop.",
      'import { x } from "@buildanagent/sdk/testing";',
      "pnpm add zod",
      "npx tsx script.ts",
    ].join("\n");
    assert.deepEqual(installProblems(text, "alpha"), []);
  });
});

describe("in the stable state", () => {
  test("accepts bare names and exact versions, and catches @alpha", () => {
    assert.deepEqual(installProblems("pnpm add @buildanagent/sdk @buildanagent/gateway@1.0.0", "stable"), []);
    const problems = installProblems("pnpm add @buildanagent/sdk@alpha @buildanagent/gateway", "stable");
    assert.deepEqual(
      problems.map((problem) => problem.token),
      ["@buildanagent/sdk@alpha"],
    );
  });
});

describe("built HTML", () => {
  // The shape Expressive Code gives a bash block: one div per line, spans inside, `&` and quotes as entities.
  const html = `<pre data-language="bash"><code><div class="ec-line"><div class="code"><span style="--0:#fff">pnpm</span><span> add @buildanagent/sdk@alpha </span><span>@buildanagent/gateway &#x26;&#x26; zod</span></div></div></code></pre><script>var a="pnpm add @buildanagent/sdk"</script>`;

  test("textOfHtml turns each rendered line into one text line, drops scripts and decodes entities", () => {
    assert.deepEqual(installLines(textOfHtml(html)), ["pnpm add @buildanagent/sdk@alpha @buildanagent/gateway && zod"]);
  });

  test("a rendered line lacking @alpha on one package is caught", () => {
    assert.equal(installProblems(textOfHtml(html), "alpha").length, 1);
  });
});

describe("the docs", () => {
  const rule = installRuleFor(SDK_VERSION);
  const advice = `${describeRule(rule)} (SDK ${SDK_VERSION})`;

  const sources = readdirSync(DOCS_DIR, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.mdx?$/.test(path))
    .map((path) => join(DOCS_DIR, path));

  test("every docs source page follows the rule, and the pages that carry install lines are found", () => {
    assert.ok(sources.length > 0, "no docs pages found");
    let found = 0;
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      found += installLines(text).length;
      assert.deepEqual(installProblems(text, rule), [], `${file}: ${advice}`);
    }
    assert.ok(found >= 6, `expected the install lines of the home and Install pages, found ${found}`);
  });

  test("every built page follows the rule", () => {
    const pages = readdirSync(builtSite(), { recursive: true, encoding: "utf8" }).filter((path) =>
      path.endsWith(".html"),
    );
    assert.ok(pages.length > 0, "the build wrote no pages");
    for (const path of pages) {
      const problems = installProblems(textOfHtml(readFileSync(join(builtSite(), path), "utf8")), rule);
      assert.deepEqual(problems, [], `${path}: ${advice}`);
    }
  });
});
