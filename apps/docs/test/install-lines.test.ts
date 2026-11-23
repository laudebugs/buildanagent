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
  test("a version with no prerelease part switches to the stable rule", () => {
    assert.equal(installRuleFor("0.1.0"), "stable");
    assert.equal(installRuleFor("1.0.0"), "stable");
  });
  test("a beta or a release candidate throws, because no tag rule exists for it and a guess would pass wrong lines", () => {
    for (const version of ["0.2.0-beta.1", "1.0.0-rc.1", "0.1.0-next.3", "0.1.0-alphabet.1"]) {
      assert.throws(() => installRuleFor(version), /no install-line rule is defined for the prerelease/, version);
    }
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
      "pnpm i @buildanagent/sdk",
      "pnpm install @buildanagent/sdk",
      "npm add @buildanagent/sdk",
      "yarn dlx @buildanagent/cli init",
      "bun add @buildanagent/sdk",
      "bunx @buildanagent/cli init",
      "pnpm add -D @buildanagent/sdk",
      "npm i -g @buildanagent/cli",
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

  test("accepts each added command with @alpha, flags and a trailing full stop included", () => {
    const text = [
      "pnpm i @buildanagent/sdk@alpha",
      "pnpm install @buildanagent/sdk@alpha",
      "npm add @buildanagent/sdk@alpha",
      "yarn dlx @buildanagent/cli@alpha init",
      "bun add @buildanagent/sdk@alpha",
      "bunx @buildanagent/cli@alpha init",
      "pnpm add -D @buildanagent/sdk@alpha",
      "npm i -g @buildanagent/cli@alpha",
      "Install it with `pnpm add @buildanagent/sdk@alpha`.",
      "Install it with pnpm add @buildanagent/sdk@alpha.",
    ].join("\n");
    assert.equal(installLines(text).length, 10);
    assert.deepEqual(installProblems(text, "alpha"), []);
  });

  test("a trailing full stop is not part of the tag, under both rules", () => {
    assert.deepEqual(installProblems("Run pnpm add @buildanagent/sdk@alpha.", "alpha"), []);
    assert.deepEqual(installProblems("Run pnpm add @buildanagent/sdk.", "stable"), []);
    assert.equal(
      installProblems("Run pnpm add @buildanagent/sdk@alpha.", "stable")[0]?.token,
      "@buildanagent/sdk@alpha",
    );
    assert.equal(installProblems("Run pnpm add @buildanagent/sdk.", "alpha")[0]?.token, "@buildanagent/sdk");
    assert.deepEqual(installProblems("(pnpm add @buildanagent/sdk@0.1.0-alpha.3.)", "stable"), []);
  });

  test("counts only the command's own arguments: a later mention in the same line is prose", () => {
    const prose = "Run `npx tsx agent.ts`; it imports `@buildanagent/gateway/testing`";
    assert.deepEqual(installProblems(prose, "alpha"), []);
    assert.deepEqual(installProblems("Run npx tsx agent.ts; it imports @buildanagent/gateway", "alpha"), []);
    assert.deepEqual(installProblems("Run `pnpm add zod` and read @buildanagent/sdk", "alpha"), []);
    assert.deepEqual(installProblems("| pnpm | `pnpm add zod` | wraps @buildanagent/sdk |", "alpha"), []);
  });

  test("stops at a shell separator, so the second command's packages are not the first's", () => {
    const line = "pnpm add @buildanagent/sdk@alpha && pnpm add zod";
    assert.deepEqual(installProblems(line, "alpha"), []);
    assert.deepEqual(
      installProblems("pnpm add zod && pnpm add @buildanagent/sdk", "alpha").map((problem) => problem.token),
      ["@buildanagent/sdk"],
    );
    assert.deepEqual(installProblems("pnpm add zod ; echo @buildanagent/sdk", "alpha"), []);
    assert.deepEqual(installProblems("pnpm add zod | tee @buildanagent/sdk", "alpha"), []);
  });

  test("a subpath is an import specifier, not an install target, and a subpath stays whole", () => {
    assert.deepEqual(installProblems("npx tsx agent.ts @buildanagent/gateway/testing", "alpha"), []);
    assert.deepEqual(installProblems("pnpm add @buildanagent/sdk@alpha @buildanagent/gateway/testing", "alpha"), []);
    // `/testing` is not cut off, so the bare package `@buildanagent/gateway` is never read from it.
    assert.deepEqual(installProblems("pnpm add @buildanagent/gateway/testing", "stable"), []);
  });

  test("a Markdown table row names each command in its own cell", () => {
    const row = "| pnpm | pnpm add @buildanagent/sdk@alpha | zod |";
    assert.equal(installLines(row).length, 1);
    assert.deepEqual(installProblems(row, "alpha"), []);
    assert.equal(
      installProblems("| pnpm | pnpm add @buildanagent/sdk | zod |", "alpha")[0]?.token,
      "@buildanagent/sdk",
    );
  });

  test("a line ending in a backslash continues on the next, as a shell reads it", () => {
    const text = "pnpm add \\\n  @buildanagent/sdk \\\n  zod";
    assert.equal(installLines(text).length, 1);
    assert.equal(installProblems(text, "alpha")[0]?.token, "@buildanagent/sdk");
    assert.deepEqual(installProblems("pnpm add \\\n  @buildanagent/sdk@alpha \\\n  zod", "alpha"), []);
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

  test("a table's cells and an inline code span end the command's arguments", () => {
    const table =
      "<tr><td>pnpm</td><td><code>pnpm add @buildanagent/sdk@alpha</code></td><td>@buildanagent/gateway</td></tr><tr><th>x</th><th>pnpm add zod</th><th>@buildanagent/sdk</th></tr>";
    assert.deepEqual(installProblems(textOfHtml(table), "alpha"), []);
    const prose =
      "<p>Run <code>npx tsx agent.ts</code>; it imports <code>@buildanagent/gateway/testing</code> and <code>pnpm add @buildanagent/sdk</code>.</p>";
    assert.deepEqual(
      installProblems(textOfHtml(prose), "alpha").map((problem) => problem.token),
      ["@buildanagent/sdk"],
    );
    assert.deepEqual(installProblems(textOfHtml("<p><code>pnpm add @buildanagent/sdk@alpha</code>.</p>"), "alpha"), []);
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
