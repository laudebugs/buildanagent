// Offline tests for the two sites' deploy scripts, site-stage-dist.mjs and site-guard-deploy.mjs, on zips and app
// folders written here. The zip rules themselves are the book's and are tested in apps/manual/scripts. Run with
// `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { checkSite, configProblems, EXPECTED, significantLines, strayConfigs } from "./site-guard-deploy.mjs";
import { ArtifactError, headersFor, NOINDEX_HEADERS, SITES, siteOf, stageSite } from "./site-stage-dist.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "site-deploy-"));
after(() => rmSync(work, { recursive: true, force: true }));

/** Writes a stored (uncompressed) zip of `files`, a map from entry name to text, the way Unix archivers do. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [entryName, text] of Object.entries(files)) {
    const name = Buffer.from(entryName, "utf8");
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

let count = 0;
/** A fresh repository root holding one app folder with main's committed wrangler.toml, and a download of `files`. */
function fixture(name, files, { headers } = {}) {
  const dir = join(work, `case-${++count}`);
  const app = join(dir, "repo", SITES[name].app);
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "wrangler.toml"), readFileSync(join(root, SITES[name].app, "wrangler.toml")));
  if (headers !== undefined) {
    mkdirSync(join(app, "public"));
    writeFileSync(join(app, "public", "_headers"), headers);
  }
  const download = join(dir, "download");
  mkdirSync(download);
  writeFileSync(join(download, "dist.zip"), zip(files));
  return { repo: join(dir, "repo"), app, download };
}

const DOCS = { "index.html": "<p>docs</p>", "404.html": "<p>404</p>", "_astro/a.css": "a{}" };

describe("the committed wrangler.toml files", () => {
  for (const name of Object.keys(SITES)) {
    test(`${name}: matches the guard's EXPECTED lines`, () => {
      assert.deepEqual(configProblems(name, readFileSync(join(root, SITES[name].app, "wrangler.toml"), "utf8")), []);
    });
  }

  test("only the docs have a next environment, on next.docs.buildanagent.fyi with no workers.dev address", () => {
    assert.ok(!EXPECTED.site.some((line) => line.startsWith("[env.")));
    const next = EXPECTED.docs.slice(EXPECTED.docs.indexOf("[env.next]"));
    assert.ok(next.includes('pattern = "next.docs.buildanagent.fyi"'));
    assert.ok(next.includes("workers_dev = false") && next.includes("preview_urls = false"));
  });

  test("production is workers_dev off, previews on, on its own custom domain, with no Worker code", () => {
    for (const name of Object.keys(SITES)) {
      const lines = EXPECTED[name];
      assert.ok(lines.includes("workers_dev = false") && lines.includes("preview_urls = true"), name);
      assert.ok(lines.includes(`pattern = "${SITES[name].domain}"`), name);
      assert.ok(!lines.some((line) => line.startsWith("main")), name);
    }
  });
});

describe("configProblems", () => {
  const text = readFileSync(join(root, "apps/docs/wrangler.toml"), "utf8");

  test("ignores blank lines, indentation and whole-line comments", () => {
    assert.deepEqual(configProblems("docs", `# a comment\n\n${text.replaceAll("\n", "\n  ")}\n# end\n`), []);
  });

  const refusals = {
    "an inline comment": text.replace("workers_dev = false", "workers_dev = false # off"),
    "a changed value": text.replace("preview_urls = true", "preview_urls = false"),
    "an added key": `${text}\n[vars]\nA = "b"\n`,
    "a Worker entry point": text.replace('name = "buildanagent-docs"', 'name = "buildanagent-docs"\nmain = "w.js"'),
    "a removed route": text.replace('pattern = "docs.buildanagent.fyi"', ""),
    "another site's config": readFileSync(join(root, "apps/site/wrangler.toml"), "utf8"),
  };
  for (const [what, changed] of Object.entries(refusals)) {
    test(`refuses ${what}`, () => assert.equal(configProblems("docs", changed).length, 1));
  }

  test("significantLines keeps a quoted # as part of its line", () => {
    assert.deepEqual(significantLines('a = "#b"\n  # c\n'), ['a = "#b"']);
  });
});

describe("staging an artifact", () => {
  test("writes the docs with no _headers when the app has none, dropping the artifact's own", () => {
    const { repo, app, download } = fixture("docs", { ...DOCS, _headers: "/*\n  X-Evil: 1\n" });
    assert.equal(stageSite("docs", download, { root: repo }), 3);
    assert.equal(readFileSync(join(app, "dist", "_astro", "a.css"), "utf8"), "a{}");
    assert.ok(!existsSync(join(app, "dist", "_headers")));
    assert.deepEqual(checkSite("docs", { root: repo }), []);
  });

  test("with --noindex writes the noindex rule, and the guard then wants --noindex", () => {
    const { repo, app, download } = fixture("docs", DOCS);
    stageSite("docs", download, { root: repo, noindex: true });
    assert.equal(readFileSync(join(app, "dist", "_headers"), "utf8"), NOINDEX_HEADERS);
    assert.deepEqual(checkSite("docs", { root: repo, noindex: true }), []);
    assert.match(checkSite("docs", { root: repo }).join(), /dist\/_headers must be absent/);
  });

  test("uses main's public/_headers when the app has one, with noindex added to its /* rule", () => {
    const headers = "/*\n  X-Frame-Options: DENY\n";
    const { repo, app, download } = fixture("site", { "index.html": "x" }, { headers });
    stageSite("site", download, { root: repo, noindex: true });
    assert.equal(readFileSync(join(app, "dist", "_headers"), "utf8"), headersFor(app, { noindex: true }));
    assert.match(
      readFileSync(join(app, "dist", "_headers"), "utf8"),
      /^\/\*\n {2}X-Robots-Tag: noindex\n {2}X-Frame-Options: DENY\n$/,
    );
    assert.deepEqual(checkSite("site", { root: repo, noindex: true }), []);
  });

  test("the website needs only index.html, the docs also 404.html", () => {
    const site = fixture("site", { "index.html": "x" });
    assert.equal(stageSite("site", site.download, { root: site.repo }), 1);
    const docs = fixture("docs", { "index.html": "x" });
    assert.throws(() => stageSite("docs", docs.download, { root: docs.repo }), /404\.html is missing/);
    assert.ok(!existsSync(join(docs.app, "dist")));
  });

  const refused = {
    "a _redirects file": { _redirects: "/ https://evil.example 302" },
    "a _worker.js file": { "_worker.js": "export default {}" },
    "a .assetsignore file": { ".assetsignore": "*" },
    "a path that climbs out": { "../x.html": "x" },
  };
  for (const [what, extra] of Object.entries(refused)) {
    test(`refuses an artifact with ${what} and writes nothing`, () => {
      const { repo, app, download } = fixture("docs", { ...DOCS, ...extra });
      assert.throws(() => stageSite("docs", download, { root: repo }), ArtifactError);
      assert.ok(!existsSync(join(app, "dist")));
    });
  }

  test("refuses a download that holds more than the one zip", () => {
    const { repo, download } = fixture("docs", DOCS);
    writeFileSync(join(download, "other.zip"), "");
    assert.throws(() => stageSite("docs", download, { root: repo }), /expected one file/);
  });

  test("refuses an unknown site name", () => assert.throws(() => siteOf("manual"), /unknown site/));
});

describe("the guard", () => {
  test("refuses a stray Wrangler config above the app", () => {
    const { repo } = fixture("site", { "index.html": "x" });
    writeFileSync(join(repo, "wrangler.json"), "{}");
    assert.match(strayConfigs(join(repo, SITES.site.app)).join(), /wrangler\.json must not exist/);
    assert.match(checkSite("site", { root: repo }).join(), /wrangler\.json must not exist/);
  });

  test("refuses a deploy before the artifact is staged", () => {
    const { repo } = fixture("site", { "index.html": "x" });
    assert.match(checkSite("site", { root: repo }).join(), /dist\/index\.html is missing/);
  });

  test("exits 2 from the command line for an unknown site", () => {
    const { repo, download } = fixture("site", { "index.html": "x" });
    stageSite("site", download, { root: repo });
    assert.deepEqual(checkSite("site", { root: repo }), []);
    const result = spawnSync(process.execPath, [join(root, "scripts/ci/site-guard-deploy.mjs"), "nope"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage/);
  });
});
