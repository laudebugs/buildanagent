// Builds and packs each package in packages/ the way a publish would, then checks the tarball: what it holds, that
// its package.json has no `source` condition, and that Node resolves every export entry to dist/ from a temp install,
// with and without `--conditions=source` (ADR 0050, as corrected by ADR 0051). Offline: `pnpm build` and `pnpm pack`
// read only the workspace. The test leaves the repo as it found it: it removes each package's dist/ and licence copies
// unless they were there before it ran. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageDirs = readdirSync(path.join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(root, "packages", entry.name, "package.json")))
  .map((entry) => path.join(root, "packages", entry.name));
const LICENCES = ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT"];
const TOP_LEVEL = new Set(["package.json", "README.md", "CHANGELOG.md", ...LICENCES]);
// A dist/ file left from an earlier build whose module no longer exists in src/. The build must delete it.
const STALE = "dist/stale-module-from-an-earlier-build.js";

let work;
let env;
let install;
const packed = new Map();
// The paths under packages/ that this test creates, so that `after` removes them and nothing else.
const created = [];

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], ...options });
}

before(() => {
  work = realpathSync(mkdtempSync(path.join(tmpdir(), "buildanagent-pack-")));
  // An allowlisted environment with a temp HOME, so no provider keys, tokens or user config reach pnpm or the imports
  // below. With a HOME that holds no pnpm cache, pnpm would try to download the `packageManager` version of itself;
  // turning manage-package-manager-versions off makes it run as installed, offline. The setting goes in the temp
  // HOME's .npmrc, not an npm_config_* variable, because the `pnpm -r` that `pnpm build` spawns doesn't see the
  // variable and downloads anyway.
  const home = path.join(work, "home");
  mkdirSync(home);
  writeFileSync(path.join(home, ".npmrc"), "manage-package-manager-versions=false\n");
  env = { PATH: process.env.PATH, HOME: home, TMPDIR: tmpdir(), LANG: "C.UTF-8" };
  for (const dir of packageDirs) {
    for (const name of ["dist", ...LICENCES]) {
      if (!existsSync(path.join(dir, name))) created.push(path.join(dir, name));
    }
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    writeFileSync(path.join(dir, STALE), "export {};\n");
  }
  run("pnpm", ["build"], { cwd: root });

  install = path.join(work, "install");
  mkdirSync(install);
  for (const dir of packageDirs) {
    const existing = new Set(readdirSync(work));
    run("pnpm", ["pack", "--pack-destination", work], { cwd: dir });
    const tarball = path.join(
      work,
      readdirSync(work).find((name) => !existing.has(name)),
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
  for (const dir of packageDirs) rmSync(path.join(dir, STALE), { force: true });
  for (const file of created) rmSync(file, { recursive: true, force: true });
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

test("every packed dist/ JavaScript file comes from a src/ TypeScript module", () => {
  for (const [name, { dir, files }] of packed) {
    const orphans = files
      .filter((file) => file.startsWith("dist/") && file.endsWith(".js"))
      .filter((file) => !existsSync(path.join(dir, "src", `${file.slice("dist/".length, -".js".length)}.ts`)));
    assert.deepEqual(orphans, [], `${name} packs dist/ files with no src/ module`);
  }
});

test("every packed source map's sources are inlined or in the tarball", () => {
  for (const [name, { files, dest }] of packed) {
    const maps = files.filter((file) => file.endsWith(".map"));
    assert.ok(maps.length > 0, `${name} packs no source maps`);
    for (const file of maps) {
      const map = JSON.parse(readFileSync(path.join(dest, file), "utf8"));
      const base = path.join(path.dirname(path.join(dest, file)), map.sourceRoot ?? "");
      map.sources.forEach((source, i) => {
        const shipped = path.resolve(base, source);
        const inTarball =
          shipped.startsWith(dest + path.sep) && files.includes(path.relative(dest, shipped).split(path.sep).join("/"));
        assert.ok(inTarball || typeof map.sourcesContent?.[i] === "string", `${name} ${file} points at ${source}`);
      });
    }
  }
});

test("the gateway's sideEffects lists the setup entry's source and built files", () => {
  // Importing @buildanagent/gateway/testing/setup installs the offline guards, so a bundler must keep the import
  // whether it resolves the workspace's `source` condition or the published `default`.
  const manifest = JSON.parse(readFileSync(path.join(root, "packages", "gateway", "package.json"), "utf8"));
  const { source, default: built } = manifest.exports["./testing/setup"];
  assert.ok(Array.isArray(manifest.sideEffects), "the gateway's sideEffects is not a list");
  for (const target of [source, built]) assert.ok(manifest.sideEffects.includes(target), `sideEffects lacks ${target}`);
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
