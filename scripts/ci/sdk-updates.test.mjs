// Offline tests for sdk-updates.mjs and sdk-updates.yml: the version choice, the check on an update's change, the
// workflow's shape, which must keep its token away from the job that runs the new releases, and open-pr's steps run
// against a local bare repository with a stand-in gh. Nothing here touches the network. Run with
// `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { FAKE_GH } from "./fake-gh.mjs";
import {
  commandLine,
  lockfileProblems,
  manifestProblems,
  newestEligible,
  parseBumps,
  parseRange,
  planBumps,
  planMatrix,
  satisfies,
  updateProblems,
} from "./sdk-updates.mjs";

const NOW = Date.parse("2026-11-19T00:00:00Z");
const OLD_TIME = "2026-10-01T00:00:00Z";
const times = {
  "1.0.0": "2026-10-01T00:00:00Z",
  "1.1.0": "2026-11-01T00:00:00Z",
  "1.2.0": "2026-11-18T00:00:00Z",
  "2.0.0-beta.1": "2026-11-02T00:00:00Z",
  "0.9.0-beta.2": "2026-11-03T00:00:00Z",
  "0.9.0-beta.1": "2026-10-03T00:00:00Z",
};
const versions = Object.keys(times);

test("picks the newest stable release at least seven days old", () => {
  assert.deepEqual(newestEligible("1.0.0", versions, times, NOW), { version: "1.1.0", published: times["1.1.0"] });
});

test("skips a release younger than seven days", () => {
  assert.equal(newestEligible("1.1.0", versions, times, NOW), undefined);
});

test("a stable pin never moves to a prerelease", () => {
  assert.equal(newestEligible("1.1.0", ["2.0.0-beta.1"], times, NOW), undefined);
});

test("a prerelease pin may move to a newer stable release or a prerelease of its own major", () => {
  assert.equal(newestEligible("0.9.0-beta.1", versions, times, NOW)?.version, "1.1.0");
  assert.equal(newestEligible("0.9.0-beta.1", ["0.9.0-beta.2"], times, NOW)?.version, "0.9.0-beta.2");
  assert.equal(newestEligible("0.9.0-beta.1", ["2.0.0-beta.1"], times, NOW), undefined);
});

test("an unparseable pin is left alone", () => {
  assert.equal(newestEligible("latest", versions, times, NOW), undefined);
});

test("skips a deprecated release", () => {
  assert.equal(newestEligible("1.0.0", versions, times, NOW, new Set(["1.1.0"])), undefined);
});

describe("parseRange and satisfies", () => {
  const ok = (version, range) => satisfies(version, parseRange(range));

  test("reads the caret, tilde, exact, comparator, x-range and || shapes npm writes", () => {
    assert.ok(ok("2.32.0", "^2.29.1") && !ok("3.0.0", "^2.29.1") && !ok("2.29.0", "^2.29.1"));
    assert.ok(ok("0.3.14", "^0.3.10") && !ok("0.4.0", "^0.3.10") && !ok("1.3.0", "^0.3.10"));
    assert.ok(ok("0.0.3", "^0.0.3") && !ok("0.0.4", "^0.0.3"));
    assert.ok(ok("4.9.0", "^4") && !ok("5.0.0", "^4") && ok("0.9.0", "^0.x") && !ok("1.0.0", "^0.x"));
    assert.ok(ok("1.4.9", "~1.4.7") && !ok("1.5.0", "~1.4.7") && ok("1.9.0", "~1") && !ok("2.0.0", "~1"));
    assert.ok(ok("1.3.27", "1.3.27") && !ok("1.3.28", "1.3.27") && ok("1.3.27", "=1.3.27"));
    assert.ok(ok("0.11.0", ">=0.11.0 <1.0.0") && !ok("1.0.0", ">=0.11.0 <1.0.0") && ok("9.0.0", ">= 0.5.0"));
    assert.ok(ok("2.9.0", "2.x") && !ok("3.0.0", "2.x") && ok("2.1.5", "2.1.*") && !ok("2.2.0", "2.1"));
    assert.ok(ok("3.0.0", ">2") && !ok("2.9.0", ">2") && ok("2.9.0", "<=2") && !ok("3.0.0", "<=2"));
    assert.ok(ok("3.25.76", "^3.25.76 || ^4") && ok("4.6.7", "^3.25.76 || ^4") && !ok("5.0.0", "^3.25.76 || ^4"));
    assert.ok(ok("9.9.9", "*") && ok("9.9.9", ""));
  });

  test("a prerelease satisfies a range only through a comparator on its own version, as in npm", () => {
    assert.ok(!ok("3.0.0-beta.1", "*") && !ok("2.30.0-rc.1", "^2.29.1"));
    assert.ok(ok("2.30.0-rc.2", "^2.30.0-rc.1") && !ok("2.30.0-rc.0", "^2.30.0-rc.1"));
  });

  test("reads hyphen ranges, `~>` as `~`, and ignores build metadata, as npm does", () => {
    assert.ok(ok("2.0.0", "1.2.3 - 2.0.0") && !ok("2.0.1", "1.2.3 - 2.0.0") && !ok("1.2.2", "1.2.3 - 2.0.0"));
    assert.ok(ok("2.9.9", "1.2 - 2") && !ok("3.0.0", "1.2 - 2") && ok("1.2.0", "1.2 - 2"));
    assert.ok(ok("1.2.9", "~>1.2") && !ok("1.3.0", "~> 1.2"));
    assert.ok(ok("1.9.0", "^1.2.3+build.5") && !ok("2.0.0", "^1.2.3+build.5") && ok("1.2.3", "1.2.3+sha.1"));
  });

  test("a prerelease pin's range admits prereleases, as npm's includePrerelease does", () => {
    const range = parseRange("^5.20260101.0");
    assert.ok(!satisfies("5.20261113.0-beta", range));
    assert.ok(satisfies("5.20261113.0-beta", range, { includePrerelease: true }));
    assert.ok(!satisfies("6.0.0-beta", range, { includePrerelease: true }));
  });

  test("ranks a numeric prerelease identifier below an alphanumeric one, as semver does", () => {
    const at = { "1.0.0-9": "2026-10-01T00:00:00Z", "1.0.0-10a": "2026-10-01T00:00:00Z" };
    assert.equal(newestEligible("1.0.0-1", Object.keys(at), at, NOW)?.version, "1.0.0-10a");
  });

  test("refuses anything that isn't a semver range rather than guess", () => {
    const refused = ["latest", "npm:other@^1.0.0", "workspace:*", "file:../x", "link:../x", "github:user/repo"];
    refused.push("git+https://github.com/user/repo.git", "https://example.com/p.tgz", "1.x.3", "^1.2-beta");
    refused.push("^1.2.3 - 2.0.0", "1.2.3 - ", "1.2.3 - 2.0.0 - 3.0.0");
    for (const range of refused) assert.equal(parseRange(range), undefined, range);
    assert.equal(parseRange(undefined), undefined);
  });
});

describe("planBumps", () => {
  const OLD = "2026-10-01T00:00:00Z";
  const NEW = "2026-11-18T00:00:00Z";
  // A registry document: each version with its publish date and the manifest fields planBumps reads.
  const doc = (releases) => ({
    versions: Object.fromEntries(Object.entries(releases).map(([v, r]) => [v, r.meta ?? {}])),
    time: Object.fromEntries(Object.entries(releases).map(([v, r]) => [v, r.at ?? OLD])),
  });
  const adk = (genai) => ({ meta: { dependencies: { "@google/genai": genai } } });
  const genai = doc({ "2.32.0": {}, "2.33.0": {}, "2.34.0": { at: NEW }, "3.1.0": {}, "3.3.0": {} });
  const zod = doc({ "4.6.7": {}, "4.7.0": {} });
  // Plans `pins` against a fake registry in which @google/adk's releases are `adkReleases`; `extra` adds or replaces
  // other packages' documents.
  const plan = async (pins, adkReleases, extra = {}) => {
    const docs = { "@google/adk": doc(adkReleases), "@google/genai": genai, zod, ...extra };
    const registry = async (name) => docs[name] ?? assert.fail(`no fake document for ${name}`);
    const { bumps, notes } = await planBumps({ dependencies: pins }, "@google/adk", registry, NOW);
    return { bumps: bumps.map((b) => `${b.name}@${b.to}`).join(" "), notes };
  };
  const pins = { "@google/adk": "2.5.0", "@google/genai": "2.32.0", zod: "4.6.7" };

  test("blocks a major main's range excludes and picks the newest in-range release old enough", async () => {
    const result = await plan(pins, { "2.5.0": adk("^2.29.1"), "3.0.0": { ...adk("^3.1.0"), at: NEW } });
    assert.equal(result.bumps, "@google/genai@2.33.0 zod@4.7.0");
    assert.deepEqual(result.notes, [
      "caps @google/genai at 2.33.0 rather than 3.3.0: @google/adk@2.5.0 declares ^2.29.1",
    ]);
  });

  test("leaves the pin when no release inside the range is newer", async () => {
    const result = await plan(pins, { "2.5.0": adk("~2.32.0") });
    assert.equal(result.bumps, "zod@4.7.0");
    assert.deepEqual(result.notes, [
      "caps @google/genai at 2.32.0 rather than 3.3.0: @google/adk@2.5.0 declares ~2.32.0",
    ]);
  });

  test("a bump of main moves the cap to the range its new release declares", async () => {
    const releases = { "2.5.0": adk("^2.29.1"), "3.0.0": adk("^3.1.0"), "3.1.0": { ...adk("^3.2"), at: NEW } };
    const result = await plan(pins, releases);
    assert.equal(result.bumps, "@google/adk@3.0.0 @google/genai@3.3.0 zod@4.7.0");
    assert.deepEqual(result.notes, []);
  });

  test("holds a package whose range it can't evaluate, and says why", async () => {
    const result = await plan(pins, { "2.5.0": adk("latest") });
    assert.equal(result.bumps, "zod@4.7.0");
    assert.deepEqual(result.notes, [
      "::warning::holds @google/genai at 2.32.0: @google/adk@2.5.0 declares latest, which this script can't evaluate",
    ]);
  });

  test("never moves main alone when a pin can't follow its new range, and falls back to an older main", async () => {
    const young = { "@google/genai": doc({ "2.32.0": {}, "2.33.0": {}, "3.1.0": { at: NEW } }) };
    const held = await plan(pins, { "2.5.0": adk("^2.29.1"), "3.0.0": adk("^3.1.0") }, young);
    assert.equal(held.bumps, "@google/genai@2.33.0 zod@4.7.0");
    assert.deepEqual(held.notes, [
      "::warning::holds @google/adk at 2.5.0 rather than 3.0.0: @google/adk@3.0.0 declares @google/genai ^3.1.0, which @google/genai@2.32.0 doesn't satisfy",
    ]);
    const releases = { "2.5.0": adk("^2.29.1"), "2.9.0": adk("^2.29.1"), "3.0.0": adk("^3.1.0") };
    const older = await plan(pins, releases, young);
    assert.equal(older.bumps, "@google/adk@2.9.0 @google/genai@2.33.0 zod@4.7.0");
    assert.match(older.notes[0], /^::warning::caps @google\/adk at 2\.9\.0 rather than 3\.0\.0: /);
  });

  test("holds main when another pin's peer range excludes main's new release", async () => {
    const peer = { "@google/genai": doc({ "2.32.0": { meta: { peerDependencies: { "@google/adk": "^2" } } } }) };
    const result = await plan(pins, { "2.5.0": {}, "3.0.0": {} }, peer);
    assert.equal(result.bumps, "zod@4.7.0");
    assert.deepEqual(result.notes, [
      "::warning::holds @google/adk at 2.5.0 rather than 3.0.0: @google/genai@2.32.0 declares @google/adk ^2, which @google/adk@3.0.0 doesn't satisfy",
    ]);
  });

  test("holds a bump whose own peer range another pin's chosen version breaks", async () => {
    const peer = {
      "@google/genai": doc({ "2.32.0": {}, "2.33.0": { meta: { peerDependencies: { zod: "<4.7.0" } } } }),
    };
    const result = await plan(pins, { "2.5.0": {} }, peer);
    assert.equal(result.bumps, "zod@4.7.0");
    assert.deepEqual(result.notes, [
      "::warning::holds @google/genai at 2.32.0 rather than 2.33.0: @google/genai@2.33.0 declares zod <4.7.0, which zod@4.7.0 doesn't satisfy",
    ]);
  });

  test("drops the range note of a capped pin the peer check moves back", async () => {
    const peer = {
      "@google/genai": doc({ "2.32.0": {}, "2.33.0": { meta: { peerDependencies: { zod: "<4.7.0" } } }, "3.3.0": {} }),
    };
    const result = await plan(pins, { "2.5.0": adk("^2") }, peer);
    assert.equal(result.bumps, "zod@4.7.0");
    assert.deepEqual(result.notes, [
      "::warning::holds @google/genai at 2.32.0 rather than 2.33.0: @google/genai@2.33.0 declares zod <4.7.0, which zod@4.7.0 doesn't satisfy",
    ]);
  });

  test("holds a bump that breaks the peer range a pin that stays declares", async () => {
    const peer = { "@google/genai": doc({ "2.32.0": { meta: { peerDependencies: { zod: "~4.6.0" } } } }) };
    const result = await plan(pins, { "2.5.0": {} }, peer);
    assert.equal(result.bumps, "");
    assert.deepEqual(result.notes, [
      "::warning::holds zod at 4.6.7 rather than 4.7.0: @google/genai@2.32.0 declares zod ~4.6.0, which zod@4.7.0 doesn't satisfy",
    ]);
  });

  test("reads optionalDependencies as a cap too", async () => {
    const meta = { optionalDependencies: { zod: "~4.6.0" } };
    const result = await plan({ "@google/adk": "2.5.0", zod: "4.6.7" }, { "2.5.0": { meta } });
    assert.equal(result.bumps, "");
    assert.deepEqual(result.notes, ["caps zod at 4.6.7 rather than 4.7.0: @google/adk@2.5.0 declares ~4.6.0"]);
  });

  test("moves a prerelease pin to a newer prerelease inside a range written for stable releases", async () => {
    const miniflare = doc({
      "5.20261103.0-beta": {},
      "5.20261113.0-beta": {},
      "5.20261120.0-beta": { at: NEW },
      "6.0.0": {},
    });
    const meta = { peerDependencies: { miniflare: "^5.20260101.0" } };
    const result = await plan(
      { "@google/adk": "2.5.0", miniflare: "5.20261103.0-beta" },
      { "2.5.0": { meta } },
      { miniflare },
    );
    assert.equal(result.bumps, "miniflare@5.20261113.0-beta");
    assert.deepEqual(result.notes, [
      "caps miniflare at 5.20261113.0-beta rather than 6.0.0: @google/adk@2.5.0 declares ^5.20260101.0",
    ]);
  });

  test("a package main declares as a dependency and a peer must satisfy both ranges", async () => {
    const meta = { dependencies: { zod: "^4" }, peerDependencies: { zod: "<4.7.0" } };
    const result = await plan({ "@google/adk": "2.5.0", zod: "4.6.7" }, { "2.5.0": { meta } });
    assert.equal(result.bumps, "");
    assert.deepEqual(result.notes, ["caps zod at 4.6.7 rather than 4.7.0: @google/adk@2.5.0 declares ^4 and <4.7.0"]);
  });

  test("a package main doesn't declare, and main itself, still move to their newest release, in pin order", async () => {
    const result = await plan(
      { zod: "4.6.7", "@google/adk": "2.5.0", "@google/genai": "2.32.0" },
      {
        "2.5.0": {},
        "2.6.0": {},
      },
    );
    assert.equal(result.bumps, "zod@4.7.0 @google/adk@2.6.0 @google/genai@3.3.0");
    assert.deepEqual(result.notes, []);
  });

  test("refuses a main package the harness doesn't pin, or a main release the registry lacks", async () => {
    await assert.rejects(plan({ zod: "4.6.7" }, {}), /@google\/adk, the package the harness tests, isn't a dependency/);
    await assert.rejects(plan(pins, { "2.4.0": {} }), /@google\/adk@2\.5\.0 isn't published/);
  });
});

describe("planMatrix", () => {
  const releases = { versions: { "1.0.0": {}, "1.1.0": {} }, time: { "1.0.0": OLD_TIME, "1.1.0": OLD_TIME } };
  const registry = async (name) => {
    if (name === "down") throw new Error("npm registry: down: HTTP 503");
    return releases;
  };
  const pinning = (...names) => ({
    manifest: { dependencies: Object.fromEntries(names.map((name) => [name, "1.0.0"])) },
    main: "main",
  });
  const load = (harness) => {
    if (harness === "unmapped") throw new Error("names no package for unmapped");
    return harness === "broken" ? pinning("main", "down") : pinning("main");
  };

  test("leaves a harness that fails out of the matrix with an error, and plans the others", async () => {
    const { matrix, log, allFailed } = await planMatrix(["ok", "broken", "unmapped"], load, registry, NOW);
    assert.deepEqual(matrix, { include: [{ harness: "ok", bumps: "main@1.1.0" }] });
    assert.deepEqual(log, [
      "::error::verify/broken: npm registry: down: HTTP 503",
      "::error::verify/unmapped: names no package for unmapped",
    ]);
    assert.equal(allFailed, false);
  });

  test("registry text and error messages can't start a workflow command of their own", async () => {
    const hostile = `^1\n::add-mask::secret\r::error::forged 100%\u001b[2J${String.fromCharCode(0x2028)}x`;
    const docs = {
      main: { versions: { "1.0.0": { dependencies: { dep: hostile } } }, time: { "1.0.0": OLD_TIME } },
      dep: releases,
    };
    const reg = async (name) => {
      if (name === "boom") throw new Error("HTTP 500\n::add-mask::token\n::warning::forged");
      return docs[name];
    };
    const harnessLoad = (harness) => (harness === "bad" ? pinning("main", "boom") : pinning("main", "dep"));
    const { log } = await planMatrix(["good", "bad"], harnessLoad, reg, NOW);
    assert.deepEqual(log, [
      "::warning::verify/good: holds dep at 1.0.0: main@1.0.0 declares ^1%0A::add-mask::secret%0D::error::forged 100%25\\x1b[2J\\x2028x, which this script can't evaluate",
      "::error::verify/bad: HTTP 500%0A::add-mask::token%0A::warning::forged",
    ]);
    for (const line of log)
      assert.ok(![...line].some((c) => c.codePointAt(0) < 0x20 || c.codePointAt(0) === 0x2028), line);
    assert.equal(commandLine(undefined, "a\nb"), "a%0Ab");
  });

  test("the plan fails when every harness does", async () => {
    const { matrix, log, allFailed } = await planMatrix(["a", "b"], () => pinning("main", "down"), registry, NOW);
    assert.deepEqual(matrix, { include: [] });
    assert.deepEqual(log, [
      "::error::verify/a: npm registry: down: HTTP 503",
      "::error::verify/b: npm registry: down: HTTP 503",
    ]);
    assert.equal(allFailed, true);
  });
});

test("every harness has a main package in the book's map", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const map = JSON.parse(readFileSync(path.join(root, "apps/manual/src/data/harnesses.json"), "utf8"));
  for (const harness of readdirSync(path.join(root, "verify"), { withFileTypes: true })) {
    if (!harness.isDirectory()) continue;
    const main = map[`verify/${harness.name}`];
    const pins = JSON.parse(readFileSync(path.join(root, "verify", harness.name, "package.json"), "utf8")).dependencies;
    assert.ok(
      typeof main === "string" && Object.hasOwn(pins, main),
      `verify/${harness.name} has no main package it pins`,
    );
  }
});

describe("updateProblems", () => {
  const entry = (status, file, dstMode = "100644") => ({ status, path: file, dstMode });

  test("accepts the harness's pins, its results and the lockfile", () => {
    const entries = [
      entry("M", "verify/pi/package.json"),
      entry("M", "pnpm-lock.yaml"),
      entry("M", "verify/pi/results/run-docs.json"),
      entry("A", "verify/pi/results/new.json"),
      entry("D", "verify/pi/results/old.json", "000000"),
    ];
    assert.deepEqual(updateProblems(entries, "pi"), []);
  });

  test("refuses any other path, including another harness, the workflows and the scripts", () => {
    for (const file of [
      "verify/langchain/package.json",
      "verify/pi/scripts/verify.mjs",
      "verify/pi-extra/results/run.json",
      "verify/pi/results/",
      "scripts/ci/version-commit.mjs",
      ".github/workflows/ci.yml",
      "package.json",
    ]) {
      const [problem] = updateProblems([entry("M", file)], "pi");
      assert.match(problem ?? "", /an update may edit only verify\/pi\/package\.json and pnpm-lock\.yaml/, file);
    }
  });

  test("refuses adding or deleting the pins or the lockfile, and renames, copies and type changes", () => {
    assert.equal(updateProblems([entry("D", "pnpm-lock.yaml", "000000")], "pi").length, 1);
    assert.equal(updateProblems([entry("A", "verify/pi/package.json")], "pi").length, 1);
    for (const status of ["R", "C", "T"]) {
      assert.match(updateProblems([entry(status, "verify/pi/results/a.json")], "pi")[0], /only additions, edits/);
    }
  });

  test("refuses executable files and symbolic links, which createCommitOnBranch can't write", () => {
    for (const mode of ["100755", "120000", "160000"]) {
      const [problem] = updateProblems([entry("A", "verify/pi/results/run.sh", mode)], "pi");
      assert.match(problem, new RegExp(`regular, non-executable file \\(mode ${mode}\\)`));
    }
  });

  test("refuses an empty change and a harness name that isn't one", () => {
    assert.deepEqual(updateProblems([], "pi"), ["the change is empty"]);
    for (const name of ["", "../pi", "pi/x", "Pi", "-pi"]) {
      assert.match(updateProblems([entry("M", "pnpm-lock.yaml")], name)[0], /isn't a harness name/);
    }
  });
});

describe("parseBumps and manifestProblems", () => {
  const before = `${JSON.stringify({ name: "verify-pi", scripts: { verify: "node v.mjs" }, dependencies: { "@s/a": "1.0.0", b: "2.0.0" } }, null, 2)}\n`;
  const bumped = (change) => {
    const manifest = JSON.parse(before);
    change(manifest);
    return `${JSON.stringify(manifest, null, 2)}\n`;
  };
  const bumps = parseBumps("@s/a@1.1.0");

  test("reads the plan's bumps and refuses anything else", () => {
    assert.deepEqual(parseBumps("@s/a@1.1.0 b@2.0.1-beta.1"), [
      { name: "@s/a", version: "1.1.0" },
      { name: "b", version: "2.0.1-beta.1" },
    ]);
    for (const bad of ["", "b", "b@latest", "@s/a", "B@1.0.0", "../x@1.0.0"]) assert.throws(() => parseBumps(bad), bad);
  });

  test("accepts exactly apply's rewrite with the planned versions", () => {
    assert.deepEqual(
      manifestProblems(
        before,
        bumped((m) => Object.assign(m.dependencies, { "@s/a": "1.1.0" })),
        bumps,
      ),
      [],
    );
  });

  test("refuses a version the plan didn't choose, a new script, dependency, override or pnpm setting", () => {
    for (const change of [
      (m) => Object.assign(m.dependencies, { "@s/a": "1.2.0" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0", b: "2.0.1" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0", evil: "1.0.0" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0" }) && Object.assign(m.scripts, { postinstall: "x" }),
      (m) => Object.assign(m.dependencies, { "@s/a": "1.1.0" }) && Object.assign(m, { pnpm: { overrides: {} } }),
    ]) {
      assert.match(manifestProblems(before, bumped(change), bumps)[0] ?? "", /changes more than the planned versions/);
    }
    assert.match(manifestProblems(before, before, parseBumps("c@1.0.0"))[0], /c isn't a dependency to bump/);
  });
});

// A small lockfile in pnpm's v9 layout: the root importer, the harness's and another harness's.
const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      typescript:
        specifier: 7.0.2
        version: 7.0.2

  verify/other:
    dependencies:
      sdk-x:
        specifier: 3.0.0
        version: 3.0.0(peer@1.0.0)

  verify/pi:
    dependencies:
      pi-ai:
        specifier: 1.0.0
        version: 1.0.0(peer@1.0.0)

packages:

  peer@1.0.0:
    resolution: {integrity: sha512-cGVlcjE=}

  pi-ai@1.0.0:
    resolution: {integrity: sha512-cGktYWkx}
    peerDependencies:
      peer: ^1.0.0 || ^2.0.0

  sdk-x@3.0.0:
    resolution: {integrity: sha512-c2RrLXg=}
    deprecated: Use your platform's sdk-y instead

  typescript@7.0.2:
    resolution: {integrity: sha512-dHM=}
    hasBin: true

snapshots:

  peer@1.0.0: {}

  pi-ai@1.0.0(peer@1.0.0):
    dependencies:
      peer: 1.0.0

  sdk-x@3.0.0(peer@1.0.0):
    dependencies:
      peer: 1.0.0

  typescript@7.0.2: {}
`;

describe("lockfileProblems", () => {
  // pi-ai 1.1.0 needs peer 2, which pnpm then shares with verify/other.
  const BUMPED = LOCK.replace(
    "specifier: 1.0.0\n        version: 1.0.0(peer@1.0.0)",
    "specifier: 1.1.0\n        version: 1.1.0(peer@2.0.0)",
  )
    .replace("version: 3.0.0(peer@1.0.0)", "version: 3.0.0(peer@2.0.0)")
    .replace(
      "  pi-ai@1.0.0:\n    resolution: {integrity: sha512-cGktYWkx}\n",
      "  peer@2.0.0:\n    resolution: {integrity: sha512-cGVlcjI=}\n    deprecated: |-\n      Use peer 3; it's: #faster\n\n  pi-ai@1.1.0:\n    resolution: {integrity: sha512-cGktYWky}\n",
    )
    // pi-ai's old snapshot goes, and sdk-x's moves with its peer, as pnpm writes them.
    .replace(
      "  pi-ai@1.0.0(peer@1.0.0):\n    dependencies:\n      peer: 1.0.0\n",
      "  peer@2.0.0: {}\n\n  pi-ai@1.1.0(peer@2.0.0):\n    dependencies:\n      peer: 2.0.0\n\n  sdk-x@3.0.0(peer@2.0.0):\n    dependencies:\n      peer: 2.0.0\n",
    );

  test("accepts a bump: the harness's pins, a peer another harness shares, and new or removed entries", () => {
    assert.deepEqual(lockfileProblems(LOCK, BUMPED, "pi"), []);
  });

  test("accepts the repository's own lockfile with any of its entries new", () => {
    const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
    for (const parity of [0, 1]) {
      let section = "";
      let n = 0;
      let skip = false;
      const lines = lock.split("\n").filter((line) => {
        if (/^\S/.test(line)) [section, skip] = [line, false];
        else if (/^(packages|snapshots):$/.test(section) && /^ {2}\S/.test(line)) skip = n++ % 2 === parity;
        return !skip;
      });
      assert.deepEqual(lockfileProblems(lines.join("\n"), lock, "pi"), []);
    }
  });

  for (const [name, edit, message] of [
    ["changes the root importer", (t) => t.replace("version: 7.0.2\n", "version: 7.0.3\n"), /changes the \. importer/],
    [
      "changes another harness's pin",
      (t) => t.replace("specifier: 3.0.0", "specifier: 3.0.1"),
      /changes the verify\/other importer$/m,
    ],
    [
      "changes another harness's resolved version",
      (t) => t.replace("version: 3.0.0(", "version: 3.0.1("),
      /verify\/other/,
    ],
    [
      "changes the harness's importer beyond its pins",
      (t) => t.replace("      pi-ai:\n", "      pi-ai:\n        optional: true\n"),
      /more of the verify\/pi importer/,
    ],
    [
      "adds an importer",
      (t) => t.replace("\npackages:", "  verify/new: {}\n\npackages:"),
      /adds, removes or reorders an importer/,
    ],
    ["changes settings", (t) => t.replace("autoInstallPeers: true", "autoInstallPeers: false"), /changes settings/],
    [
      "adds overrides",
      (t) => t.replace("\nimporters:", "\noverrides:\n  typescript: 9.9.9\n\nimporters:"),
      /sections changed/,
    ],
    [
      "rewrites an existing package",
      (t) => t.replace("sha512-dHM=", "sha512-ZXZpbA=="),
      /changes packages typescript@7\.0\.2/,
    ],
    [
      "rewrites an existing snapshot",
      (t) => t.replace("  typescript@7.0.2: {}", "  typescript@7.0.2:\n    dependencies:\n      evil: 1.0.0"),
      /changes snapshots typescript@7\.0\.2/,
    ],
    [
      "respells an existing package to list it twice",
      (t) =>
        t.replace("\nsnapshots:", '  "typescript@7.0.2":\n    resolution: {integrity: sha512-ZXZpbA==}\n\nsnapshots:'),
      /isn't an entry pnpm writes/,
    ],
    [
      "lists a package twice",
      (t) =>
        t.replace("\nsnapshots:", "  typescript@7.0.2:\n    resolution: {integrity: sha512-ZXZpbA==}\n\nsnapshots:"),
      /lists typescript@7\.0\.2 twice/,
    ],
    [
      "adds a package from a tarball URL",
      (t) =>
        t.replace(
          "\nsnapshots:",
          "  evil@1.0.0:\n    resolution: {tarball: https://example.invalid/e.tgz}\n\nsnapshots:",
        ),
      /evil@1\.0\.0 doesn't resolve from the npm registry/,
    ],
    [
      "opens a quote that swallows the next entry",
      (t) => t.replace("    hasBin: true", "    hasBin: 'true"),
      /isn't an entry|holds a line pnpm doesn't write|changes packages/,
    ],
    [
      "adds an alias",
      (t) =>
        t.replace(
          "\nsnapshots:",
          "  evil@1.0.0:\n    resolution: {integrity: sha512-ZXZpbA==}\n    x: *a\n\nsnapshots:",
        ),
      /evil@1\.0\.0 holds a line pnpm doesn't write/,
    ],
    [
      "opens a flow mapping across lines",
      (t) => t.replace("\nsnapshots:", "  evil@1.0.0:\n    resolution: {integrity: sha512-ZXZpbA==\n\nsnapshots:"),
      /holds a line pnpm doesn't write|doesn't resolve/,
    ],
    [
      "indents a line by three",
      (t) => t.replace("\nsnapshots:", "  evil@1.0.0:\n   x: 1\n\nsnapshots:"),
      /badly indented/,
    ],
    [
      "points the harness's dependency at a local path",
      (t) => t.replace("version: 1.1.0(peer@2.0.0)", "version: link:results/evil"),
      /verify\/pi importer points a dependency at something other than a registry version/,
    ],
    [
      "points another harness's peer at a local path",
      (t) => t.replace("version: 3.0.0(peer@2.0.0)", "version: 3.0.0(peer@file:x)"),
      /verify\/other importer.s sdk-x: peer peer@file:x isn.t a registry version/,
    ],
    [
      "gives a new snapshot a local dependency",
      (t) => t.replace("      peer: 2.0.0", "      peer: link:../../verify/pi/results"),
      /snapshot pi-ai@1\.1\.0\(peer@2\.0\.0\) depends on something other than a registry version/,
    ],
    ["uses a tab", (t) => t.replace("hasBin: true", "hasBin:\ttrue"), /tab or a carriage return/],
  ]) {
    test(`refuses a lockfile that ${name}`, () => {
      const after = edit(BUMPED);
      assert.notEqual(after, BUMPED, "the edit applies");
      assert.match(lockfileProblems(LOCK, after, "pi").join("\n"), message);
    });
  }
});

describe("lockfileProblems on peers that move in other importers", () => {
  // A lockfile shaped like main's on 2026-11-22: an app's wrangler, the cloudflare-agents harness that pins
  // @cloudflare/workers-types and miniflare, and another harness whose sdk-x has a peer.
  const MAIN = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  apps/docs:
    devDependencies:
      wrangler:
        specifier: 4.160.1
        version: 4.160.1(@types/node@26.6.6)

  apps/manual:
    devDependencies:
      wrangler:
        specifier: 4.160.1
        version: 4.160.1(@types/node@26.6.6)

  verify/cloudflare-agents:
    dependencies:
      '@cloudflare/workers-types':
        specifier: 5.20261103.1
        version: 5.20261103.1
      miniflare:
        specifier: 5.20261103.0-beta
        version: 5.20261103.0-beta
      x:
        specifier: 1.0.0
        version: 1.0.0

  verify/other:
    dependencies:
      sdk-x:
        specifier: 3.0.0
        version: 3.0.0(x@1.0.0)

packages:

  miniflare@4.20261110.0:
    resolution: {integrity: sha512-bTQ=}
    peerDependencies:
      '@cloudflare/workers-types': ^5.20261110.1

  wrangler@4.160.1:
    resolution: {integrity: sha512-dw==}
    hasBin: true
    peerDependencies:
      '@cloudflare/workers-types': ^5.20261110.1
    peerDependenciesMeta:
      '@cloudflare/workers-types':
        optional: true

  x@1.0.0:
    resolution: {integrity: sha512-eDE=}

snapshots:

  '@cloudflare/workers-types@5.20261103.1': {}

  '@types/node@26.6.6': {}

  left-pad@1.0.0: {}

  miniflare@4.20261110.0:
    dependencies:
      workerd: 1.20261110.1

  miniflare@5.20261103.0-beta:
    dependencies:
      workerd: 1.20261110.1

  sdk-x@3.0.0(x@1.0.0):
    dependencies:
      x: 1.0.0

  workerd@1.20261110.1: {}

  wrangler@4.160.1(@types/node@26.6.6):
    dependencies:
      miniflare: 4.20261110.0
      workerd: 1.20261110.1
    optionalDependencies:
      fsevents: 2.3.3
    transitivePeerDependencies:
      - '@types/node'

  x@1.0.0: {}
`;
  const WORKERS = "@cloudflare/workers-types@5.20261115.1";
  const bumps = parseBumps(`${WORKERS} miniflare@5.20261113.0-beta`);
  const OLD_WRANGLER = "wrangler@4.160.1(@types/node@26.6.6)";
  const NEW_WRANGLER = `wrangler@4.160.1(${WORKERS})(@types/node@26.6.6)`;
  const wranglerBody = (deps = "      miniflare: 4.20261110.0\n      workerd: 1.20261110.1", optional = "") =>
    `    dependencies:\n${deps}\n    optionalDependencies:\n${optional}      fsevents: 2.3.3\n    transitivePeerDependencies:\n      - '@types/node'\n`;
  // What pnpm writes for the bumps: the harness's pins, the new packages and snapshots, and wrangler's peer resolved to
  // the bumped workers-types in both apps, with its snapshot renamed and given one optional dependency.
  const honest = ({
    workersSnapshot = "{}",
    body = wranglerBody(undefined, `      '@cloudflare/workers-types': 5.20261115.1\n`),
    apps = ["docs", "manual"],
  } = {}) => {
    let text = MAIN.replace(
      "specifier: 5.20261103.1\n        version: 5.20261103.1",
      "specifier: 5.20261115.1\n        version: 5.20261115.1",
    )
      .replace(
        "specifier: 5.20261103.0-beta\n        version: 5.20261103.0-beta",
        "specifier: 5.20261113.0-beta\n        version: 5.20261113.0-beta",
      )
      .replace(
        "\nsnapshots:\n",
        `  '${WORKERS}':\n    resolution: {integrity: sha512-d2s=}\n\n  miniflare@5.20261113.0-beta:\n    resolution: {integrity: sha512-bWY=}\n\nsnapshots:\n`,
      )
      .replace(
        "  '@types/node@26.6.6': {}\n",
        `  '${WORKERS}':${workersSnapshot.startsWith("\n") ? workersSnapshot : ` ${workersSnapshot}`}\n\n  '@types/node@26.6.6': {}\n`,
      )
      .replace("  miniflare@5.20261103.0-beta:\n", "  miniflare@5.20261113.0-beta:\n")
      .replace(`  ${OLD_WRANGLER}:\n${wranglerBody()}`, `  ${NEW_WRANGLER}:\n${body}`);
    for (const app of apps) {
      text = text.replace(
        `  apps/${app}:\n    devDependencies:\n      wrangler:\n        specifier: 4.160.1\n        version: 4.160.1(@types/node@26.6.6)`,
        `  apps/${app}:\n    devDependencies:\n      wrangler:\n        specifier: 4.160.1\n        version: 4.160.1(${WORKERS})(@types/node@26.6.6)`,
      );
    }
    return text;
  };
  const problems = (after, planned = bumps) => lockfileProblems(MAIN, after, "cloudflare-agents", planned).join("\n");

  test("accepts the honest cloudflare-agents update", () => {
    assert.equal(problems(honest()), "");
  });

  test("refuses the reviewer's patch: wrangler's own miniflare swapped to a bump, and left-pad added to both bumps", () => {
    const leftPad = "\n    dependencies:\n      left-pad: 1.3.0";
    const body = wranglerBody(
      "      miniflare: 5.20261113.0-beta\n      workerd: 1.20261110.1",
      `      '@cloudflare/workers-types': 5.20261115.1\n`,
    );
    const patch = honest({ workersSnapshot: leftPad, body })
      .replace(
        "  miniflare@5.20261113.0-beta:\n    dependencies:\n",
        `  miniflare@5.20261113.0-beta:\n    dependencies:\n      left-pad: 1.3.0\n`,
      )
      .replace("  x@1.0.0: {}", "  left-pad@1.3.0: {}\n\n  x@1.0.0: {}");
    assert.match(problems(patch), /moves miniflare from 4\.20261110\.0 to 5\.20261113\.0-beta/);
  });

  test("refuses a bump's new snapshot that adds a dependency neither main nor the bumps hold", () => {
    const patch = honest({ workersSnapshot: "\n    dependencies:\n      left-pad: 1.3.0" }).replace(
      "  x@1.0.0: {}",
      "  left-pad@1.3.0: {}\n\n  x@1.0.0: {}",
    );
    assert.match(
      problems(patch),
      /points @cloudflare\/workers-types at the new snapshot @cloudflare\/workers-types@5\.20261115\.1, which depends on left-pad@1\.3\.0, which is neither in main/,
    );
    // A dependency main already holds unchanged is main's code, and passes.
    assert.equal(problems(honest({ workersSnapshot: "\n    dependencies:\n      left-pad: 1.0.0" })), "");
  });

  test("checks a snapshot two importers share once, and holds every importer to it", () => {
    const patch = honest({ body: wranglerBody(undefined, "      evil: 1.0.0\n") });
    const lines = problems(patch).split("\n");
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.match(
      lines[0],
      /the apps\/docs importer's wrangler@4\.160\.1\(@types\/node@26\.6\.6\): the snapshot .* changes more than/,
    );
  });

  for (const [name, body] of [
    [
      "puts the bumped peer under another heading",
      wranglerBody(
        `      '@cloudflare/workers-types': 5.20261115.1\n      miniflare: 4.20261110.0\n      workerd: 1.20261110.1`,
      ),
    ],
    [
      "adds a dependency line under transitivePeerDependencies",
      `${wranglerBody(undefined, `      '@cloudflare/workers-types': 5.20261115.1\n`)}      left-pad: 1.0.0\n`,
    ],
    [
      "adds a heading of its own",
      wranglerBody(
        undefined,
        `      '@cloudflare/workers-types': 5.20261115.1\n    dependencies:\n      left-pad: 1.0.0\n`,
      ),
    ],
    [
      "lists the bumped peer twice",
      wranglerBody(
        undefined,
        `      '@cloudflare/workers-types': 5.20261115.1\n      '@cloudflare/workers-types': 5.20261115.1\n`,
      ),
    ],
    [
      "drops a dependency",
      wranglerBody("      miniflare: 4.20261110.0", `      '@cloudflare/workers-types': 5.20261115.1\n`),
    ],
  ]) {
    test(`refuses a moved snapshot that ${name}`, () => {
      assert.match(problems(honest({ body })), /changes more than|lists @cloudflare\/workers-types twice/);
    });
  }

  test("accepts an ordinary dependency that gains a bumped peer when its snapshot moves the same way, and nothing else", () => {
    const withPeer = (peer) =>
      honest({
        body: wranglerBody(
          `      miniflare: 4.20261110.0(${peer})\n      workerd: 1.20261110.1`,
          `      '@cloudflare/workers-types': 5.20261115.1\n`,
        ),
      }).replace(
        "  miniflare@4.20261110.0:\n    dependencies:\n      workerd: 1.20261110.1\n",
        `  miniflare@4.20261110.0(${peer}):\n    dependencies:\n      '${peer.replace(/@([^@]+)$/, "': $1")}\n      workerd: 1.20261110.1\n`,
      );
    assert.equal(problems(withPeer(WORKERS)), "");
    assert.match(
      problems(withPeer("left-pad@1.0.0")),
      /changes miniflare's peers: peer left-pad@1\.0\.0 isn't one of the planned bumps/,
    );
  });

  for (const [name, version, message] of [
    [
      "names a longer version than the bump",
      "4.160.1(@cloudflare/workers-types@5.20261115.10)(@types/node@26.6.6)",
      /isn't one of the planned bumps/,
    ],
    [
      "names an npm alias",
      "4.160.1(@cloudflare/workers-types@npm:evil@1.0.0)(@types/node@26.6.6)",
      /isn't a registry version/,
    ],
    ["quotes the version", `'4.160.1(${WORKERS})(@types/node@26.6.6)'`, /changes the apps\/docs importer$/m],
    ["uses a YAML anchor", `4.160.1(&a ${WORKERS})(@types/node@26.6.6)`, /isn't a registry version/],
    ["uses a flow mapping", `4.160.1({${WORKERS}})(@types/node@26.6.6)`, /isn't a registry version/],
    ["nests an unbalanced group", `4.160.1(${WORKERS}(x@1.0.0)(@types/node@26.6.6)`, /aren't a list pnpm writes/],
  ]) {
    test(`refuses a workspace importer whose peer ${name}`, () => {
      const patch = honest().replace(`version: 4.160.1(${WORKERS})(@types/node@26.6.6)`, `version: ${version}`);
      assert.match(problems(patch), message);
    });
  }

  test("refuses another harness's peer that the updated harness doesn't resolve, and accepts one it does", () => {
    const evil = honest()
      .replace("version: 3.0.0(x@1.0.0)", "version: 3.0.0(evil@9.9.9)")
      .replace(
        "  sdk-x@3.0.0(x@1.0.0):\n    dependencies:\n      x: 1.0.0\n",
        "  sdk-x@3.0.0(evil@9.9.9):\n    dependencies:\n      evil: 9.9.9\n",
      )
      .replace("  x@1.0.0: {}", "  evil@9.9.9: {}\n\n  x@1.0.0: {}");
    assert.match(
      problems(evil),
      /verify\/other importer's sdk-x: peer evil@9\.9\.9 isn't in the updated harness's own resolution/,
    );
    const shared = honest()
      .replace("specifier: 1.0.0\n        version: 1.0.0\n", "specifier: 2.0.0\n        version: 2.0.0\n")
      .replace("version: 3.0.0(x@1.0.0)", "version: 3.0.0(x@2.0.0)")
      .replace(
        "  sdk-x@3.0.0(x@1.0.0):\n    dependencies:\n      x: 1.0.0\n",
        "  sdk-x@3.0.0(x@2.0.0):\n    dependencies:\n      x: 2.0.0\n",
      )
      .replace("  x@1.0.0: {}", "  x@1.0.0: {}\n\n  x@2.0.0: {}")
      .replace("\nsnapshots:\n", "  x@2.0.0:\n    resolution: {integrity: sha512-eDI=}\n\nsnapshots:\n");
    assert.equal(problems(shared), "");
    // The same move with sdk-x's snapshot gaining a dependency is refused.
    const more = shared.replace(
      "  sdk-x@3.0.0(x@2.0.0):\n    dependencies:\n      x: 2.0.0\n",
      "  sdk-x@3.0.0(x@2.0.0):\n    dependencies:\n      evil: 9.9.9\n      x: 2.0.0\n",
    );
    assert.match(problems(more), /the snapshot sdk-x@3\.0\.0\(x@2\.0\.0\) changes more than/);
  });

  test("refuses peer groups that aren't the plan's bumps, and any change with no bumps", () => {
    assert.match(problems(honest(), parseBumps("miniflare@5.20261113.0-beta")), /isn't one of the planned bumps/);
    const wrong = honest().replaceAll(WORKERS, "@cloudflare/workers-types@5.20261116.0");
    assert.match(problems(wrong), /peer @cloudflare\/workers-types@5\.20261116\.0 isn't one of the planned bumps/);
  });

  test("refuses a changed specifier, base version or dependency list in a workspace importer", () => {
    const base = honest().replace(`version: 4.160.1(${WORKERS})`, `version: 4.160.2(${WORKERS})`);
    assert.match(problems(base), /changes the apps\/docs importer$/m);
    const specifier = honest().replace("specifier: 4.160.1", "specifier: 4.160.2");
    assert.match(problems(specifier), /changes the apps\/docs importer$/m);
    const added = honest().replace(
      "      wrangler:\n",
      "      evil:\n        specifier: 1.0.0\n        version: 1.0.0\n      wrangler:\n",
    );
    assert.match(problems(added), /changes the apps\/docs importer$/m);
    const link = honest().replace(`version: 4.160.1(${WORKERS})(@types/node@26.6.6)`, "version: link:../../evil");
    assert.match(problems(link), /changes the apps\/docs importer$/m);
  });

  test("keeps an importer that fails out of the moved snapshots, so its snapshot isn't reported", () => {
    // apps/manual moves wrangler but also changes its specifier; only apps/docs's move is followed.
    const patch = honest({ body: wranglerBody(undefined, "      evil: 1.0.0\n"), apps: ["manual"] }).replace(
      "  apps/manual:\n    devDependencies:\n      wrangler:\n        specifier: 4.160.1",
      "  apps/manual:\n    devDependencies:\n      wrangler:\n        specifier: 4.160.2",
    );
    const lines = problems(patch).split("\n");
    assert.deepEqual(lines, ["pnpm-lock.yaml: changes the apps/manual importer"]);
  });
});

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowText = readFileSync(path.join(root, ".github/workflows/sdk-updates.yml"), "utf8");
const workflow = parse(workflowText);
const { jobs } = workflow;

describe("sdk-updates.yml", () => {
  test("only open-pr's last step reads a secret, a personal access token, and the run's own token only reads", () => {
    const readers = [];
    for (const [name, job] of Object.entries(jobs)) {
      if (JSON.stringify({ ...job, steps: undefined }).includes("secrets.")) readers.push(`${name} (job)`);
      job.steps.forEach((step, i) => {
        if (JSON.stringify(step).includes("secrets.")) readers.push(`${name} step ${i}`);
      });
    }
    assert.deepEqual(readers, [`open-pr step ${jobs["open-pr"].steps.length - 1}`]);
    assert.equal(
      jobs["open-pr"].steps.at(-1).env.GH_TOKEN,
      `\${{ secrets.SDK_UPDATES_TOKEN || secrets.RELEASE_PR_TOKEN }}`,
    );
    // GITHUB_TOKEN would open a pull request whose CI runs wait for someone's approval.
    assert.doesNotMatch(workflowText, /github\.token|secrets\.GITHUB_TOKEN/);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    for (const [name, job] of Object.entries(jobs)) {
      assert.ok(job.permissions === undefined || JSON.stringify(job.permissions) === '{"contents":"read"}', name);
      for (const step of job.steps) {
        if (step.uses?.startsWith("actions/checkout")) assert.equal(step.with?.["persist-credentials"], false, name);
      }
    }
  });

  test("no run step expands an expression, so no matrix or event field can be injected into a script", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps) assert.doesNotMatch(step.run ?? "", /\$\{\{/, `${name}: ${step.name ?? step.run}`);
    }
  });

  test("the update job, which runs the new releases, holds no token", () => {
    const { update } = jobs;
    for (const step of update.steps) {
      for (const key of Object.keys(step.env ?? {})) assert.doesNotMatch(key, /TOKEN|AUTH/i, step.name);
    }
    assert.equal(update.env, undefined);
  });

  test("open-pr runs no third-party code, checks the patch before the token step, and never turns on auto-merge", () => {
    const job = jobs["open-pr"];
    assert.doesNotMatch(JSON.stringify(job), /\bpnpm\b|\bnpx\b|node_modules|\bnpm\b|\byarn\b|corepack/);
    const uses = job.steps.filter((s) => s.uses).map((s) => s.uses.replace(/@.*/, ""));
    assert.deepEqual(uses, ["actions/checkout", "actions/download-artifact"]);
    const [, , commit, push] = job.steps;
    assert.equal(commit.env, undefined, "the step that checks the patch holds no token");
    assert.match(commit.run, /git apply --cached --binary/);
    assert.doesNotMatch(commit.run, /--index/);
    const nodeCalls = job.steps.flatMap((s) => (s.run ?? "").match(/\bnode\b.*$/gm) ?? []);
    assert.deepEqual(nodeCalls, [
      'node scripts/ci/sdk-updates.mjs check "$HARNESS" "$base" HEAD "$BUMPS"',
      'node scripts/ci/version-commit.mjs --replace-own-only "$BASE" HEAD "$branch" "deps/staging/sdk-$HARNESS"',
    ]);
    assert.equal(job.env.BUMPS, `\${{ matrix.bumps }}`, "the check compares the patch with the plan's bumps");
    assert.doesNotMatch(push.run, /summary\.md|SUMMARY/, "the pull request's body is the one the commit step wrote");
    assert.equal(push.if, "steps.commit.outputs.changed == 'true'");
    assert.doesNotMatch(push.run, /git push|x-access-token|gh pr merge|--auto/);
    assert.ok(push.run.indexOf("version-commit.mjs") < push.run.indexOf("gh pr list"));
  });

  test("the update job writes the plan's bumps rather than asking the registry again", () => {
    const step = jobs.update.steps.find((s) => /sdk-updates\.mjs apply/.test(s.run ?? ""));
    assert.equal(step.run, 'node scripts/ci/sdk-updates.mjs apply "$HARNESS" "$BUMPS" > bumps.md');
    assert.equal(step.env.BUMPS, `\${{ matrix.bumps }}`);
  });

  test("runs only from main, and opens the other harnesses' pull requests when one harness's update fails", () => {
    assert.equal(jobs.plan.if, "github.ref == 'refs/heads/main'");
    assert.deepEqual(jobs.update.needs, "plan");
    assert.equal(
      jobs["open-pr"].if,
      `\${{ !cancelled() && needs.plan.result == 'success' && needs.plan.outputs.any == 'true' }}`,
    );
  });

  test("sdk-updates.mjs and version-commit.mjs import nothing but node: modules and the scripts beside them", () => {
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(path.join(root, "scripts/ci", file), "utf8");
      for (const [, spec] of text.matchAll(/^import [^;]*?from "([^"]+)";/gms)) {
        if (spec.startsWith("node:")) continue;
        assert.match(spec, /^\.\/[a-z-]+\.mjs$/, `${file} imports ${spec}`);
        visit(spec.slice(2));
      }
      assert.doesNotMatch(text, /\bimport\(/, `${file} has a dynamic import`);
    };
    visit("sdk-updates.mjs");
    visit("version-commit.mjs");
    assert.deepEqual([...seen].sort(), [
      "changeset-gate.mjs",
      "release-plan.mjs",
      "sdk-updates.mjs",
      "version-commit.mjs",
      "version-pr.mjs",
    ]);
  });
});

// These tests run open-pr's own shell scripts, taken from sdk-updates.yml, in a temp folder. The fake gh from
// fake-gh.mjs acts on a local bare repository that stands for the one on GitHub, so nothing touches the network.
describe("sdk-updates.yml's open-pr steps, run for real", () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const harness = "pi";
  const branch = "deps/sdk-pi";
  const staging = "deps/staging/sdk-pi";
  const job = jobs["open-pr"];
  const title = job.env.TITLE.replace(`\${{ matrix.harness }}`, harness);
  const bumps = "pi-ai@1.1.0";
  const manifest = (version) =>
    `${JSON.stringify({ name: "verify-pi", dependencies: { "pi-ai": version } }, null, 2)}\n`;

  // A main with one harness and the CI scripts, pushed to a bare remote, and a checkout of it as open-pr's checkout is.
  function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), "sdk-updates-steps-"));
    dirs.push(dir);
    const remote = path.join(dir, "remote.git");
    const work = path.join(dir, "work");
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "gh"), FAKE_GH);
    chmodSync(path.join(bin, "gh"), 0o755);
    writeFileSync(path.join(dir, "gitconfig"), "[user]\n\tname = test\n\temail = test@example.invalid\n");
    const env = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      HOME: dir,
      LANG: "C.UTF-8",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
    };
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    mkdirSync(work);
    git(work, "init", "-q", "-b", "main");
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), text);
    };
    write("verify/pi/package.json", manifest("1.0.0"));
    write("verify/pi/results/run-docs.json", '{"pass":1}\n');
    write("verify/pi/results/old.json", "{}\n");
    write("pnpm-lock.yaml", LOCK);
    for (const script of ["sdk-updates.mjs", "version-pr.mjs", "changeset-gate.mjs", "release-plan.mjs"]) {
      write(`scripts/ci/${script}`, readFileSync(path.join(root, "scripts/ci", script), "utf8"));
    }
    write("scripts/ci/version-commit.mjs", readFileSync(path.join(root, "scripts/ci/version-commit.mjs"), "utf8"));
    git(work, "add", "-A");
    git(work, "commit", "-qm", "main");
    git(work, "remote", "add", "origin", remote);
    git(work, "push", "-q", "origin", "main");
    return { dir, remote, work, env, git, write };
  }

  // Writes the update job's artifact: the patch, made the way its step makes it, and the summary.
  function artifact(repo, change) {
    const update = path.join(repo.dir, "runner", "update");
    mkdirSync(update, { recursive: true });
    change(repo);
    repo.git(repo.work, "add", "-A");
    const patch = execFileSync("git", ["diff", "--cached", "--binary"], { cwd: repo.work, env: repo.env });
    writeFileSync(path.join(update, "update.patch"), patch);
    writeFileSync(path.join(update, "summary.md"), "| `pi-ai` | 1.0.0 | 1.1.0 | 2026-11-01 |\n");
    repo.git(repo.work, "reset", "-q", "--hard");
  }
  const bump = ({ write }) => {
    write("verify/pi/package.json", manifest("1.1.0"));
    write("verify/pi/results/run-docs.json", '{"pass":2}\n');
    write(
      "pnpm-lock.yaml",
      LOCK.replace("specifier: 1.0.0\n        version: 1.0.0", "specifier: 1.1.0\n        version: 1.1.0"),
    );
  };

  // Runs open-pr's commit step in a fresh clone of main, then its token step when the commit step says there is a change.
  function runOpenPr(repo, extraEnv = {}) {
    const clone = path.join(repo.dir, `pr-${Math.random().toString(36).slice(2)}`);
    repo.git(repo.dir, "clone", "-q", "-b", "main", repo.remote, clone);
    const runner = path.join(repo.dir, "runner");
    const output = path.join(repo.dir, "commit-output");
    writeFileSync(output, "");
    const log = path.join(repo.dir, "gh-log");
    writeFileSync(log, "");
    const [, , commit, push] = job.steps;
    const env = {
      ...repo.env,
      HARNESS: harness,
      BUMPS: bumps,
      TITLE: title,
      RUNNER_TEMP: runner,
      GITHUB_OUTPUT: output,
    };
    const commitRun = spawnSync("bash", ["-e", "-c", commit.run], { cwd: clone, env, encoding: "utf8" });
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    if (commitRun.status !== 0 || outputs.changed !== "true") return { commit: commitRun, outputs, gh: [], clone };
    const pushRun = spawnSync("bash", ["-e", "-c", push.run], {
      cwd: clone,
      env: {
        ...env,
        GH_TOKEN: "secret",
        REPO: "o/r",
        BASE: outputs.base,
        GH_LOG: log,
        FAKE_REMOTE: repo.remote,
        ...extraEnv,
      },
      encoding: "utf8",
    });
    const gh = readFileSync(log, "utf8").split("\n").filter(Boolean);
    return { commit: commitRun, push: pushRun, outputs, gh, clone };
  }
  const ref = (repo, name) => {
    try {
      return repo.git(repo.remote, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`);
    } catch {
      return "";
    }
  };
  const signed = (repo) => {
    const file = path.join(repo.remote, "signed");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  };
  const prCalls = (gh) => gh.filter((call) => !call.startsWith("api "));

  test("makes the update commit through the API, verified, and opens a pull request without auto-merge", () => {
    const repo = setup();
    const main = ref(repo, "main");
    artifact(repo, (r) => {
      bump(r);
      rmSync(path.join(r.work, "verify/pi/results/old.json"));
    });
    const run = runOpenPr(repo);
    assert.equal(run.commit.status, 0, run.commit.stderr);
    assert.equal(run.push.status, 0, run.push.stderr);
    const head = ref(repo, branch);
    assert.deepEqual(signed(repo), [head], "the branch holds the commit made through createCommitOnBranch");
    assert.equal(repo.git(repo.remote, "rev-parse", `${head}^{tree}`), repo.git(run.clone, "rev-parse", "HEAD^{tree}"));
    assert.equal(repo.git(repo.remote, "rev-parse", `${head}^`), main);
    assert.equal(repo.git(repo.remote, "log", "-1", "--format=%s", head), title);
    assert.equal(repo.git(repo.remote, "log", "-1", "--format=%b", head), "Bumps verify/pi to pi-ai@1.1.0.");
    const body = readFileSync(path.join(repo.dir, "runner", "body.md"), "utf8");
    assert.match(body, /^Bumps `verify\/pi` to `pi-ai@1\.1\.0`\. The plan job chose these releases/);
    assert.match(body, /a malicious release could have rewritten it\.\n\n\| `pi-ai` \| 1\.0\.0 \| 1\.1\.0 \|/);
    assert.equal(ref(repo, staging), "", "the staging branch is deleted");
    assert.equal(ref(repo, "main"), main, "main stays as it was");
    const calls = prCalls(run.gh);
    assert.equal(calls.length, 2);
    assert.match(
      calls[0],
      /^pr list --repo o\/r --head deps\/sdk-pi --base main --state open --json number,isCrossRepository/,
    );
    assert.match(calls[0], /select\(\.isCrossRepository \| not\)/, "a fork's branch of the same name doesn't count");
    assert.match(
      calls[1],
      /^pr create --repo o\/r --base main --head deps\/sdk-pi --title chore\(deps\): update the pi.* --body-file .*body\.md$/,
    );
    assert.ok(!run.gh.some((call) => /pr merge/.test(call)), "auto-merge stays off");
  });

  test("a rerun on the same main changes nothing and updates the open pull request", () => {
    const repo = setup();
    artifact(repo, bump);
    assert.equal(runOpenPr(repo).push.status, 0);
    const head = ref(repo, branch);
    const run = runOpenPr(repo, { EXISTING_PR: "42" });
    assert.equal(run.push.status, 0, run.push.stderr);
    assert.equal(ref(repo, branch), head);
    assert.deepEqual(signed(repo), [head]);
    assert.match(run.push.stdout, /already holds the checked commit, verified/);
    assert.match(prCalls(run.gh).at(-1), /^pr edit 42 --repo o\/r --title chore\(deps\)/);
  });

  for (const [name, change, message] of [
    [
      "rewrites the script that makes the commit",
      (r) => {
        bump(r);
        r.write("scripts/ci/version-commit.mjs", "steal();\n");
      },
      /M scripts\/ci\/version-commit\.mjs: an update may edit only/,
    ],
    ["edits a workflow", (r) => r.write(".github/workflows/ci.yml", "on: push\n"), /A \.github\/workflows\/ci\.yml/],
    [
      "adds a script to the harness's package.json",
      (r) => {
        bump(r);
        r.write(
          "verify/pi/package.json",
          manifest("1.1.0").replace('"name"', '"scripts": { "postinstall": "steal" },\n  "name"'),
        );
      },
      /verify\/pi\/package\.json: changes more than the planned versions \(pi-ai@1\.1\.0\)/,
    ],
    [
      "moves the root's tools in the lockfile",
      (r) => {
        bump(r);
        r.write(
          "pnpm-lock.yaml",
          readFileSync(path.join(r.work, "pnpm-lock.yaml"), "utf8").replace("version: 7.0.2\n", "version: 7.0.3\n"),
        );
      },
      /pnpm-lock\.yaml: changes the \. importer/,
    ],
    [
      "adds an executable file",
      (r) => {
        r.write("verify/pi/results/run.sh", "#!/bin/sh\n");
        chmodSync(path.join(r.work, "verify/pi/results/run.sh"), 0o755);
      },
      /mode 100755/,
    ],
  ]) {
    test(`refuses a patch that ${name}, before any token step`, () => {
      const repo = setup();
      artifact(repo, change);
      const run = runOpenPr(repo);
      assert.notEqual(run.commit.status, 0);
      assert.match(run.commit.stderr, message);
      assert.equal(run.push, undefined);
      assert.deepEqual(run.gh, []);
      assert.equal(ref(repo, branch), "");
    });
  }

  test("refuses to drop a commit someone pushed to the update branch, and leaves its pull request alone", () => {
    const repo = setup();
    artifact(repo, bump);
    assert.equal(runOpenPr(repo).push.status, 0);
    // A maintainer re-mirrors the docs on the pull request's branch.
    const pushed = path.join(repo.dir, "maintainer");
    repo.git(repo.dir, "clone", "-q", "-b", branch, repo.remote, pushed);
    writeFileSync(path.join(pushed, "notes.md"), "re-mirrored\n");
    repo.git(pushed, "add", "-A");
    repo.git(pushed, "commit", "-qm", "docs(pi): re-mirror the docs at the new tag");
    repo.git(pushed, "push", "-q", "origin", branch);
    const head = ref(repo, branch);
    // main moves on, so the next run's checked commit differs from the branch's.
    repo.write("verify/pi/results/later.json", "{}\n");
    repo.git(repo.work, "add", "-A");
    repo.git(repo.work, "commit", "-qm", "later");
    repo.git(repo.work, "push", "-q", "origin", "main");
    artifact(repo, bump);
    const run = runOpenPr(repo, { EXISTING_PR: "42" });
    assert.notEqual(run.push.status, 0);
    assert.match(run.push.stderr, /isn't a commit this workflow made, so deps\/sdk-pi stays as it was/);
    assert.equal(ref(repo, branch), head);
    assert.deepEqual(prCalls(run.gh), []);
  });

  test("fails, leaving the update branch and the pull request alone, when GitHub doesn't verify the commit", () => {
    const repo = setup();
    artifact(repo, bump);
    const run = runOpenPr(repo, { UNVERIFIED: "1" });
    assert.notEqual(run.push.status, 0);
    assert.match(run.push.stderr, /didn't verify the signature/);
    assert.equal(ref(repo, branch), "");
    assert.equal(ref(repo, staging), "");
    assert.deepEqual(prCalls(run.gh), []);
  });

  test("fails before any call when neither token is set", () => {
    const repo = setup();
    artifact(repo, bump);
    const run = runOpenPr(repo, { GH_TOKEN: "" });
    assert.notEqual(run.push.status, 0);
    assert.match(run.push.stdout, /Neither SDK_UPDATES_TOKEN nor RELEASE_PR_TOKEN is set/);
    assert.deepEqual(run.gh, []);
  });

  test("an empty patch opens nothing", () => {
    const repo = setup();
    artifact(repo, () => {});
    const run = runOpenPr(repo);
    assert.equal(run.commit.status, 0, run.commit.stderr);
    assert.equal(run.outputs.changed, "false");
    assert.deepEqual(run.gh, []);
  });
});
