// Builds and packs each package in packages/ the way a publish would, then checks the tarball: what it holds, that
// its package.json has no `source` condition, and that Node resolves every export entry to dist/ from a temp install,
// with and without `--conditions=source` (ADR 0050). Offline: `pnpm build` and `pnpm pack` read only the workspace.
// Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageDirs = readdirSync(path.join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(root, "packages", entry.name));
const LICENCES = ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT"];
const TOP_LEVEL = new Set(["package.json", "README.md", "CHANGELOG.md", ...LICENCES]);

let work;
let env;
let install;
const packed = new Map();

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], ...options });
}

before(() => {
  work = realpathSync(mkdtempSync(path.join(tmpdir(), "buildanagent-pack-")));
  // An allowlisted environment: no provider keys or tokens reach pnpm or the imports below. HOME stays real, because
  // pnpm with an empty HOME downloads the packageManager version of itself instead of running offline.
  env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir(), LANG: "C.UTF-8" };
  run("pnpm", ["build"], { cwd: root });

  install = path.join(work, "install");
  mkdirSync(install);
  for (const dir of packageDirs) {
    const before = new Set(readdirSync(work));
    run("pnpm", ["pack", "--pack-destination", work], { cwd: dir });
    const tarball = path.join(
      work,
      readdirSync(work).find((name) => !before.has(name)),
    );
    const manifest = JSON.parse(run("tar", ["-xzOf", tarball, "package/package.json"]));
    const files = run("tar", ["-tzf", tarball])
      .split("\n")
      .filter(Boolean)
      .map((name) => name.replace(/^package\//, ""));
    const dest = path.join(install, "node_modules", manifest.name);
    mkdirSync(dest, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", dest, "--strip-components=1"]);
    packed.set(manifest.name, { dir, manifest, files, dest });
  }
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

test("every package is packed", () => {
  assert.equal(packed.size, packageDirs.length);
});

test("each tarball holds only package.json, README, CHANGELOG, the licences and dist/", () => {
  for (const [name, { files }] of packed) {
    const strays = files.filter((file) => !TOP_LEVEL.has(file) && !file.startsWith("dist/"));
    assert.deepEqual(strays, [], `${name} packs files outside dist/`);
    for (const licence of LICENCES) assert.ok(files.includes(licence), `${name} lacks ${licence}`);
    assert.ok(files.includes("README.md"), `${name} lacks README.md`);
  }
});

test("each packed package.json has no source condition, and every entry's files are in the tarball", () => {
  for (const [name, { manifest, files }] of packed) {
    assert.ok(!JSON.stringify(manifest.exports).includes('"source"'), `${name} ships a source condition`);
    assert.equal(manifest.publishConfig, undefined, `${name} still carries publishConfig`);
    for (const [entry, conditions] of Object.entries(manifest.exports)) {
      assert.deepEqual(Object.keys(conditions), ["types", "default"], `${name} ${entry} lists types first`);
      for (const target of Object.values(conditions)) {
        assert.ok(files.includes(target.replace(/^\.\//, "")), `${name} ${entry} points at missing ${target}`);
      }
    }
  }
});

test("every packed declaration file imports only its own dist/ files or other packages by name", () => {
  for (const [name, { files, dest }] of packed) {
    const dist = path.join(dest, "dist") + path.sep;
    for (const file of files.filter((f) => f.endsWith(".d.ts"))) {
      const text = readFileSync(path.join(dest, file), "utf8");
      const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((match) => match[1]);
      const strays = specifiers.filter((spec) =>
        spec.startsWith(".")
          ? !path.resolve(path.dirname(path.join(dest, file)), spec).startsWith(dist)
          : /\/src\//.test(spec),
      );
      assert.deepEqual(strays, [], `${name} ${file}`);
    }
  }
});

for (const conditions of [[], ["--conditions=source"]]) {
  const label = conditions.length ? "with --conditions=source" : "with no extra condition";
  test(`Node imports every packed entry from dist/ ${label}`, () => {
    for (const [name, { manifest, dest }] of packed) {
      for (const entry of Object.keys(manifest.exports)) {
        const specifier = entry === "." ? name : `${name}/${entry.slice(2)}`;
        const script = `const url = import.meta.resolve(${JSON.stringify(specifier)}); await import(url); console.log(url);`;
        const url = run(process.execPath, [...conditions, "--input-type=module", "-e", script], {
          cwd: install,
        }).trim();
        const resolved = fileURLToPath(url);
        assert.ok(resolved.startsWith(path.join(dest, "dist") + path.sep), `${specifier} resolved to ${resolved}`);
      }
    }
  });
}
