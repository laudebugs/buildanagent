// Tests for guard-deploy.mjs: the committed wrangler.jsonc passes, each of the seven rules refuses on its own, and the
// JSONC parser keeps comments and commas inside strings. Run with `node --test scripts/*.test.mjs` from apps/manual.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkApp, DOMAIN, parseJsonc, problemsIn, strayConfigs } from "./guard-deploy.mjs";

const app = fileURLToPath(new URL("..", import.meta.url));
const committed = parseJsonc(readFileSync(join(app, "wrangler.jsonc"), "utf8"));
const HEADERS = { source: "/*\n  X: y\n", deployed: "/*\n  X: y\n" };
const work = mkdtempSync(join(tmpdir(), "guard-deploy-"));
after(() => rmSync(work, { recursive: true, force: true }));

const withConfig = (change) => {
  const config = structuredClone(committed);
  change(config);
  return config;
};

describe("parseJsonc", () => {
  test("drops comments and trailing commas outside strings and keeps them inside", () => {
    const text = `{
      // a comment
      "url": "https://example.com/*not a comment*/", /* block */
      "list": ["a,]", "b",],
      "odd": "a // b",
    }`;
    assert.deepEqual(parseJsonc(text), {
      url: "https://example.com/*not a comment*/",
      list: ["a,]", "b"],
      odd: "a // b",
    });
  });

  test("a trailing comma before a comment and a closer is dropped", () => {
    assert.deepEqual(parseJsonc('{ "a": 1, // last\n }'), { a: 1 });
  });

  test("an unclosed comment or string is a syntax error", () => {
    assert.throws(() => parseJsonc('{ "a": 1 /* open'), SyntaxError);
    assert.throws(() => parseJsonc('{ "a": "open'), SyntaxError);
  });
});

describe("the committed config", () => {
  test("passes every rule", () => {
    assert.deepEqual(problemsIn(committed, HEADERS), []);
  });

  test("names an assets-only Worker with an empty previews block", () => {
    assert.equal(committed.name, "buildanagent-manual");
    assert.deepEqual(committed.previews, {});
    assert.equal(committed.build, undefined);
  });
});

describe("each rule refuses on its own", () => {
  const cases = [
    ["a second route", (c) => c.routes.push({ pattern: "other.buildanagent.fyi", custom_domain: true }), /"routes"/],
    ["a route that is not a custom domain", (c) => (c.routes[0].custom_domain = false), /"routes"/],
    ["another domain", (c) => (c.routes[0].pattern = "evil.example.com"), /"routes"/],
    ["a route that also serves previews", (c) => (c.routes[0].previews_enabled = true), /"routes"/],
    ["no routes", (c) => delete c.routes, /"routes"/],
    ["a main entry", (c) => (c.main = "src/worker.ts"), /"main" must be absent/],
    ["another assets directory", (c) => (c.assets.directory = "./public"), /"assets.directory"/],
    ["single-page fallback", (c) => (c.assets.not_found_handling = "single-page-application"), /not_found_handling/],
    ["workers.dev in production", (c) => (c.workers_dev = true), /"workers_dev"/],
    ["workers_dev left to its default", (c) => delete c.workers_dev, /"workers_dev"/],
    ["previews off", (c) => (c.preview_urls = false), /"preview_urls"/],
    ["preview_urls left to its default", (c) => delete c.preview_urls, /"preview_urls"/],
  ];
  for (const [name, change, pattern] of cases) {
    test(name, () => {
      const problems = problemsIn(withConfig(change), HEADERS);
      assert.equal(problems.length, 1, problems.join("\n"));
      assert.match(problems[0], pattern);
    });
  }

  test("no assets block breaks both assets rules", () => {
    const problems = problemsIn(
      withConfig((c) => delete c.assets),
      HEADERS,
    );
    assert.equal(problems.length, 2);
  });

  test("a missing public/_headers", () => {
    const problems = problemsIn(committed, { source: null, deployed: null });
    assert.deepEqual(problems, ["public/_headers must exist: it holds the content security policy"]);
  });

  test("a dist/_headers that is missing or differs from main's", () => {
    assert.match(problemsIn(committed, { ...HEADERS, deployed: null })[0], /\.\/dist\/_headers .* it is missing/);
    assert.match(problemsIn(committed, { ...HEADERS, deployed: "/*\n  X: z\n" })[0], /it differs/);
  });

  test("the domain is the book's", () => {
    assert.equal(DOMAIN, "manual.buildanagent.fyi");
  });
});

describe("the command", () => {
  function appWith({ config, headers = HEADERS }) {
    const dir = mkdtempSync(join(work, "app-"));
    if (config !== undefined) writeFileSync(join(dir, "wrangler.jsonc"), config);
    mkdirSync(join(dir, "public"));
    mkdirSync(join(dir, "dist"));
    if (headers.source !== null) writeFileSync(join(dir, "public", "_headers"), headers.source);
    if (headers.deployed !== null) writeFileSync(join(dir, "dist", "_headers"), headers.deployed);
    return dir;
  }
  const run = (dir) =>
    spawnSync(process.execPath, [join(app, "scripts", "guard-deploy.mjs"), dir], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });

  test("passes on the committed config with main's _headers in dist/", () => {
    const dir = appWith({ config: readFileSync(join(app, "wrangler.jsonc"), "utf8") });
    copyFileSync(join(app, "public", "_headers"), join(dir, "public", "_headers"));
    copyFileSync(join(app, "public", "_headers"), join(dir, "dist", "_headers"));
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Deploy guard passed/);
  });

  test("refuses, listing every problem, and exits 1", () => {
    const config = JSON.stringify({ ...committed, main: "x.js", workers_dev: true });
    const result = run(appWith({ config }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Deploy refused[\s\S]*"main"[\s\S]*"workers_dev"/);
  });

  test("refuses a missing or unreadable config", () => {
    assert.deepEqual(checkApp(appWith({})), ["wrangler.jsonc is missing"]);
    assert.match(checkApp(appWith({ config: "{ nope" }))[0], /could not be read/);
    assert.deepEqual(checkApp(appWith({ config: "[]" })), ["wrangler.jsonc must hold an object"]);
  });
});

describe("another config Wrangler could read", () => {
  // A repository root with apps/manual inside it, holding the committed config and main's _headers in both places.
  function tree() {
    const top = mkdtempSync(join(work, "tree-"));
    const dir = join(top, "apps", "manual");
    mkdirSync(join(dir, "public"), { recursive: true });
    mkdirSync(join(dir, "dist"));
    copyFileSync(join(app, "wrangler.jsonc"), join(dir, "wrangler.jsonc"));
    writeFileSync(join(dir, "public", "_headers"), HEADERS.source);
    writeFileSync(join(dir, "dist", "_headers"), HEADERS.source);
    return { top, dir };
  }

  test("none: the committed tree passes", () => {
    assert.deepEqual(checkApp(tree().dir), []);
  });

  // Wrangler 4.160.1 looks for wrangler.json up the whole path before wrangler.jsonc, so any of these would win.
  for (const [where, name] of [
    ["beside it", "wrangler.json"],
    ["beside it", "wrangler.toml"],
    ["in apps/", "wrangler.json"],
    ["at the repository root", "wrangler.jsonc"],
    ["at the repository root", "wrangler.toml"],
  ]) {
    test(`a ${name} ${where} is refused`, () => {
      const { top, dir } = tree();
      const at = { "beside it": dir, "in apps/": join(top, "apps"), "at the repository root": top }[where];
      writeFileSync(join(at, name), "{}");
      const problems = checkApp(dir);
      assert.equal(problems.length, 1, problems.join("\n"));
      assert.match(problems[0], new RegExp(`${name.replace(".", "\\.")} must not exist`));
    });
  }

  test("a .wrangler/deploy/config.json redirect beside the config or above it is refused", () => {
    for (const level of [0, 2]) {
      const { top, dir } = tree();
      const at = level === 0 ? dir : top;
      mkdirSync(join(at, ".wrangler", "deploy"), { recursive: true });
      writeFileSync(join(at, ".wrangler", "deploy", "config.json"), '{ "configPath": "../../other.jsonc" }');
      assert.match(checkApp(dir)[0], /\.wrangler\/deploy\/config\.json must not exist/);
    }
  });

  test("the app's own wrangler.jsonc is not a stray", () => {
    const { dir } = tree();
    assert.deepEqual(strayConfigs(dir), []);
  });
});
