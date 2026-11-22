// Packs each package in packages/ the way a publish would, relying on its `prepack` script to build dist/, then checks
// the tarball: what it holds, that its package.json has no `source` condition, and that Node resolves every export
// entry to dist/ from a temp install, with and without `--conditions=source` (ADR 0050, as corrected by ADR 0051). The
// pack tests skip unless the installed pnpm is the `packageManager` version. Offline: `pnpm pack` and the build it
// runs read only the workspace. The test leaves the repo as it found it: it removes each package's dist/ and licence
// copies unless they were there before it ran. It also holds the six packages that will publish (PUBLISHED) to the
// rules they must meet once they do, though four are still private: each ships an llms.txt, none depends on a
// workspace package outside the six, and the packed protocol's JavaScript imports neither the gateway nor the SDK.
// It ends with two install checks: a fresh project installs the gateway's and SDK's tarballs with pnpm, offline, and
// makes one model call through the Anthropic adapter against a mock server on the loopback interface, and another
// installs the CLI's tarball and runs its `buildanagent --help`. Every install links each third-party runtime
// dependency, such as the SDK's validator, from the workspace's own install, since the registry is out of reach. The
// install checks live here, not in their own file, because `node --test` runs files in parallel and two files packing
// the same folders would race on dist/. Run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageDirs = dependencyOrder(
  readdirSync(path.join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, "packages", entry.name, "package.json")))
    .map((entry) => path.join(root, "packages", entry.name)),
);

/**
 * The package folders with each one after the workspace packages it depends on, as `pnpm -r build` orders them. Each
 * `prepack` builds against the dist/ of those packages, so the safety package, which depends on the gateway, must
 * pack after it.
 */
function dependencyOrder(dirs) {
  const byName = new Map(
    dirs.map((dir) => [JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name, dir]),
  );
  const ordered = [];
  const visit = (name) => {
    const dir = byName.get(name);
    if (dir === undefined || ordered.includes(dir)) return;
    const { dependencies = {} } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const dependency of Object.keys(dependencies)) visit(dependency);
    ordered.push(dir);
  };
  for (const name of byName.keys()) visit(name);
  return ordered;
}
// The packages that will publish (ADR 0058). The gateway and the SDK already do; the other four are still `private`
// until todo L11, so the checks that must hold once they publish go by this list, never by the `private` field.
const PUBLISHED = [
  "@buildanagent/gateway",
  "@buildanagent/sdk",
  "@buildanagent/agent-safety",
  "@buildanagent/protocol",
  "@buildanagent/harness",
  "@buildanagent/cli",
];
// Every package in the workspace, by name, so the dependency check below can tell ours from third-party ones.
const WORKSPACE_PACKAGES = ["apps", "packages", "verify"].flatMap((group) =>
  readdirSync(path.join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, group, entry.name, "package.json")))
    .map((entry) => JSON.parse(readFileSync(path.join(root, group, entry.name, "package.json"), "utf8")).name),
);
const LICENCES = ["LICENSE", "LICENSE-APACHE", "LICENSE-MIT"];
const TOP_LEVEL = new Set(["package.json", "README.md", "CHANGELOG.md", "llms.txt", ...LICENCES]);
// A dist/ file left from an earlier build whose module no longer exists in src/. The build must delete it.
const STALE = "dist/stale-module-from-an-earlier-build.js";
// The pack tests run pnpm as installed (see `before`), so a global pnpm other than the `packageManager` version would
// build and pack differently from CI. They skip, saying why, rather than pass on a different pnpm.
const { packageManager } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const wantedPnpm = packageManager.replace(/^pnpm@/, "");
const installedPnpm = execFileSync("pnpm", ["--version"], {
  encoding: "utf8",
  env: { PATH: process.env.PATH, HOME: tmpdir(), npm_config_manage_package_manager_versions: "false" },
}).trim();
const skip =
  installedPnpm === wantedPnpm
    ? false
    : `the installed pnpm is ${installedPnpm}, but package.json's packageManager is pnpm@${wantedPnpm}; install that version to run the pack tests`;
if (skip) console.warn(`packages-pack: skipping, ${skip}`);
const packTest = (name, fn) => test(name, { skip }, fn);

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
  if (skip) return;
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
  // No `pnpm build` here: `pnpm pack` must build through `prepack`, or a pack from a clean checkout ships no code and
  // the stale file above stays in the tarball.

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
    packed.set(manifest.name, { dir, manifest, files, dest, tarball });
  }
  // The registry is out of reach, so each third-party runtime dependency is linked from the workspace's own install.
  for (const [name, dir] of thirdPartyDependencies()) {
    const link = path.join(install, "node_modules", name);
    if (existsSync(link)) continue;
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(dir, link, "dir");
  }
});

/**
 * The runtime dependencies of the packed packages that are not packed themselves, as [name, installed directory]
 * pairs. Each directory is the workspace's install of the dependency, which stands in for the registry offline.
 */
function thirdPartyDependencies() {
  const found = new Map();
  for (const { dir, manifest } of packed.values()) {
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!packed.has(name)) found.set(name, realpathSync(path.join(dir, "node_modules", name)));
    }
  }
  return found;
}

/** The `source` targets in a package's exports, at any depth of conditions. */
function sourceTargets(exports) {
  if (typeof exports !== "object" || exports === null) return [];
  return Object.entries(exports).flatMap(([key, value]) =>
    key === "source" && typeof value === "string" ? [value] : sourceTargets(value),
  );
}

/**
 * The third-party runtime dependencies of a packed package, and of the packed packages it depends on, that ship a
 * `source` condition pointing at a file their tarball lacks. Node fails to load such a dependency under
 * `--conditions=source`, whatever our own manifests say, and a package that imports our SDK at run time reaches the
 * SDK's dependencies too.
 */
function brokenSourceDependencies(manifest) {
  const names = Object.keys(manifest.dependencies ?? {});
  const own = names
    .filter((name) => !packed.has(name))
    .filter((name) => {
      const dir = path.join(install, "node_modules", name);
      const { exports } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      return sourceTargets(exports).some((target) => !existsSync(path.join(dir, target)));
    });
  const inherited = names
    .filter((name) => packed.has(name))
    .flatMap((name) => brokenSourceDependencies(packed.get(name).manifest));
  return [...new Set([...own, ...inherited])];
}

after(() => {
  for (const dir of packageDirs) rmSync(path.join(dir, STALE), { force: true });
  for (const file of created) rmSync(file, { recursive: true, force: true });
  if (work) rmSync(work, { recursive: true, force: true });
});

packTest("every package is packed", () => {
  assert.equal(packed.size, packageDirs.length);
  for (const name of PUBLISHED) assert.ok(packed.has(name), `${name} was not packed`);
});

packTest("each tarball holds only package.json, README, CHANGELOG, llms.txt, the licences and dist/", () => {
  for (const [name, { files }] of packed) {
    const strays = files.filter((file) => !TOP_LEVEL.has(file) && !file.startsWith("dist/"));
    assert.deepEqual(strays, [], `${name} packs files outside dist/`);
    for (const licence of LICENCES) assert.ok(files.includes(licence), `${name} lacks ${licence}`);
    assert.ok(files.includes("README.md"), `${name} lacks README.md`);
    // Every package that will publish ships its docs index, so a missing one fails now rather than at the publish.
    if (PUBLISHED.includes(name)) assert.ok(files.includes("llms.txt"), `${name} lacks llms.txt`);
  }
});

packTest("every packed dist/ JavaScript file comes from a src/ TypeScript module", () => {
  for (const [name, { dir, files }] of packed) {
    const orphans = files
      .filter((file) => file.startsWith("dist/") && file.endsWith(".js"))
      .filter((file) => !existsSync(path.join(dir, "src", `${file.slice("dist/".length, -".js".length)}.ts`)));
    assert.deepEqual(orphans, [], `${name} packs dist/ files with no src/ module`);
  }
});

packTest("every packed source map's sources are inlined or in the tarball", () => {
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

packTest("each packed package.json has no source condition, and every entry's files are in the tarball", () => {
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

packTest("every packed package.json depends on published versions, not workspace: ranges", () => {
  for (const [name, { manifest }] of packed) {
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
      assert.ok(!range.startsWith("workspace:"), `${name} depends on ${dep}@${range}`);
    }
  }
  const sdk = packed.get("@buildanagent/sdk")?.manifest;
  const gateway = packed.get("@buildanagent/gateway")?.manifest;
  assert.ok(sdk && gateway, "the SDK or the gateway was not packed");
  assert.equal(sdk.dependencies?.["@buildanagent/gateway"], gateway.version, "the SDK's gateway range");
});

test("tsconfig.base.json, which verify/* extends, adds no export conditions", () => {
  // A `source` condition there would make the harnesses type-check third-party packages that ship one from their raw
  // src/*.ts. Only tsconfig.packages.json names it, for our own packages.
  const base = JSON.parse(readFileSync(path.join(root, "tsconfig.base.json"), "utf8"));
  assert.equal(base.compilerOptions.customConditions, undefined);
  const packages = JSON.parse(readFileSync(path.join(root, "tsconfig.packages.json"), "utf8"));
  assert.deepEqual(packages.compilerOptions.customConditions, ["source"]);
});

packTest("every packed declaration file imports only its own dist/ files or other packages by name", () => {
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

// The entries that fail to import under `--conditions=source`, because they reach pi-schema 1.5.2, whose `source`
// condition names a file its tarball lacks. The harness's `session`, `tools`, `permissions`, `extensions` and
// `server` entries reach it through the SDK; the protocol and the CLI's entries don't. The list is in exports order.
// Every other entry must import; an entry listed here that imports again fails the test, so the list is cut once
// pi-schema ships a fix.
const SOURCE_CONDITION_FAILURES = [
  "@buildanagent/sdk",
  "@buildanagent/harness/session",
  "@buildanagent/harness/tools",
  "@buildanagent/harness/permissions",
  "@buildanagent/harness/extensions",
  "@buildanagent/harness/server",
];

// The entries that fail to import in this install, which holds no optional peer, because they exist to wrap one: the
// safety package's `./byok` imports `@ai-sdk/anthropic` and `@ai-sdk/openai` at load, and its `./cost` imports `ai`,
// as its README says, and its `./stores/dynamodb` imports `@aws-sdk/client-dynamodb`. The failure must be ERR_MODULE_NOT_FOUND naming one of the package's declared optional peers.
// Every other entry, the root entry included, must import. An entry listed here that imports again fails the test.
const OPTIONAL_PEER_FAILURES = [
  "@buildanagent/agent-safety/byok",
  "@buildanagent/agent-safety/cost",
  "@buildanagent/agent-safety/stores/dynamodb",
];

for (const conditions of [[], ["--conditions=source"]]) {
  const label = conditions.length ? "with --conditions=source" : "with no extra condition";
  packTest(`Node imports every packed entry from dist/ ${label}`, (t) => {
    const failed = [];
    const missingPeer = [];
    for (const [name, { manifest, dest }] of packed) {
      const optionalPeers = Object.entries(manifest.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta.optional)
        .map(([peer]) => peer);
      // A dependency with a broken `source` condition can't load under it. An entry that reaches such a dependency
      // may fail to import only with an error naming that dependency; every other entry must import. The run with no
      // extra condition imports them all.
      const broken = conditions.length ? brokenSourceDependencies(manifest) : [];
      for (const entry of Object.keys(manifest.exports)) {
        const specifier = entry === "." ? name : `${name}/${entry.slice(2)}`;
        const tolerated = JSON.stringify(broken);
        const script = `const url = import.meta.resolve(${JSON.stringify(specifier)});
try { await import(url); } catch (error) {
  const peer = error?.code === "ERR_MODULE_NOT_FOUND" ? ${JSON.stringify(optionalPeers)}.find((dep) => String(error.message).includes(\`'\${dep}'\`)) : undefined;
  if (peer !== undefined) { console.error(\`missing peer: \${peer}\`); console.log(url); process.exit(0); }
  const named = ${tolerated}.find((dep) => String(error?.stack ?? error).includes(dep));
  if (named === undefined) throw error;
  console.error(\`broken source: \${named}\`);
}
console.log(url);`;
        const child = spawnSync(process.execPath, [...conditions, "--input-type=module", "-e", script], {
          cwd: install,
          encoding: "utf8",
          env,
        });
        assert.equal(child.status, 0, `${specifier} failed to import ${label}: ${child.stderr}`);
        const absent = /^missing peer: (.+)$/m.exec(child.stderr)?.[1];
        if (absent) {
          missingPeer.push(specifier);
          t.diagnostic(`${specifier}: not imported ${label}, because its optional peer ${absent} is not installed`);
          continue;
        }
        const skipped = /^broken source: (.+)$/m.exec(child.stderr)?.[1];
        if (skipped) {
          failed.push(specifier);
          t.diagnostic(`${specifier}: not imported ${label}, because ${skipped} ships a missing source`);
        }
        const url = child.stdout.trim();
        const resolved = fileURLToPath(url);
        assert.ok(resolved.startsWith(path.join(dest, "dist") + path.sep), `${specifier} resolved to ${resolved}`);
      }
    }
    assert.deepEqual(failed, conditions.length ? SOURCE_CONDITION_FAILURES : []);
    assert.deepEqual(missingPeer, OPTIONAL_PEER_FAILURES);
  });
}

/** The module specifiers a JavaScript file imports or re-exports, statically or through `import()`. */
function importedSpecifiers(text) {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((match) => match[1]);
}

packTest("the packed protocol's JavaScript imports neither the gateway nor the SDK", () => {
  // The protocol uses both for types only, so a client can depend on the wire types without the loop's code.
  const { files, dest } = packed.get("@buildanagent/protocol") ?? {};
  assert.ok(files, "the protocol was not packed");
  const forbidden = ["@buildanagent/gateway", "@buildanagent/sdk"];
  const scripts = files.filter((file) => file.endsWith(".js"));
  assert.ok(scripts.length > 0, "the protocol packs no JavaScript");
  for (const file of scripts) {
    const reached = importedSpecifiers(readFileSync(path.join(dest, file), "utf8")).filter((spec) =>
      forbidden.some((name) => spec === name || spec.startsWith(`${name}/`)),
    );
    assert.deepEqual(reached, [], `the packed protocol's ${file} imports them`);
  }
  // The scan above reads the specifiers; this loads the entry where neither package is installed, so an import the
  // scan misses still fails. It copies rather than links, because Node resolves a linked package's imports from the
  // link's target, which sits beside both.
  const alone = path.join(work, "protocol-alone");
  cpSync(dest, path.join(alone, "node_modules", "@buildanagent", "protocol"), { recursive: true });
  run(process.execPath, ["--input-type=module", "-e", 'await import("@buildanagent/protocol");'], { cwd: alone });
});

packTest("no package that will publish depends on a workspace package that won't", () => {
  // The rule reads names, not `private`: four of the six are private until they publish, and the check must hold
  // from now on, so that none of them ships a dependency npm will never hold, such as the private evals package.
  for (const name of PUBLISHED) {
    const { manifest } = packed.get(name) ?? {};
    assert.ok(manifest, `${name} was not packed`);
    const unpublished = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ].filter((dep) => WORKSPACE_PACKAGES.includes(dep) && !PUBLISHED.includes(dep));
    assert.deepEqual(unpublished, [], `${name} depends on workspace packages that won't publish`);
  }
});

packTest("the safety package's root entry loads and hashes in an install without its optional peers", () => {
  // The SDK will import this entry (ADR 0043), so it must load where `ai` and `@ai-sdk/*` are absent, as they are here.
  const { manifest } = packed.get("@buildanagent/agent-safety") ?? {};
  assert.ok(manifest, "the safety package was not packed");
  const peers = Object.keys(manifest.peerDependencies ?? {});
  assert.ok(peers.length > 0, "the safety package declares no optional peers");
  for (const peer of peers) assert.ok(!existsSync(path.join(install, "node_modules", peer)), `${peer} is installed`);
  const script = `const { canonicalInputHash } = await import("@buildanagent/agent-safety");
console.log(await canonicalInputHash({ b: 1, a: 2 }));`;
  const hash = run(process.execPath, ["--input-type=module", "-e", script], { cwd: install }).trim();
  assert.match(hash, /^[0-9a-f]{64}$/);
});

// The program the fresh project runs: one call to the mock server, whose URL comes in as its only argument. It prints
// the reply's text and stop reason, and checks that the SDK's root and testing exports load from the installed
// package.
const CALL_PROGRAM = `
import { createModel } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";

if (typeof ScriptedModel !== "function") throw new Error("ScriptedModel did not load");
// Defining a tool compiles its schema, so this loads the SDK's root entry and its validator from the install.
const lookup = { name: "lookup", description: "Look up.", inputSchema: { type: "object" } };
defineTool({ ...lookup, execute: async () => ({ content: [] }) });
const model = createModel({ adapter: anthropic({ apiKey: "sk-test-not-a-real-key", baseURL: process.argv[2] }), id: "claude-opus-5-5" });
const message = await model.complete({ messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }], tools: [] });
console.log(JSON.stringify({ content: message.content, stopReason: message.stopReason, output: message.usage.output }));
`;

// One Anthropic Messages stream, in the shape the gateway's own fixtures record.
const STREAM = [
  {
    type: "message_start",
    message: {
      id: "msg_install_check",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [],
      stop_reason: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi from the mock" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
  { type: "message_stop" },
]
  .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join("");

/**
 * Makes a fresh project at `app` that depends on the packed packages `names` and installs it with pnpm, offline, as
 * `pnpm add <name>@<tag>` would with the registry swapped for the tarballs. The overrides point each packed package's
 * own dependencies on our packages at their tarballs, and link each third-party dependency to the workspace's install
 * of it, which stands in for the registry.
 */
function installTarballs(app, names) {
  const tarballs = Object.fromEntries([...packed].map(([name, { tarball }]) => [name, `file:${tarball}`]));
  writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({
      name: path.basename(app),
      private: true,
      type: "module",
      dependencies: Object.fromEntries(names.map((name) => [name, tarballs[name]])),
      pnpm: {
        overrides: {
          ...tarballs,
          ...Object.fromEntries([...thirdPartyDependencies()].map(([name, dir]) => [name, `link:${dir}`])),
        },
      },
    }),
  );
  run("pnpm", ["install", "--offline", "--store-dir", path.join(work, "store")], { cwd: app });
}

packTest(
  "a fresh project installs both tarballs offline and makes one call through the Anthropic adapter",
  async () => {
    const sdk = packed.get("@buildanagent/sdk");
    const gateway = packed.get("@buildanagent/gateway");
    const app = path.join(work, "fresh-project");
    mkdirSync(app);
    installTarballs(app, ["@buildanagent/sdk", "@buildanagent/gateway"]);
    writeFileSync(path.join(app, "call.mjs"), CALL_PROGRAM);
    const installed = (name) =>
      JSON.parse(readFileSync(path.join(app, "node_modules", name, "package.json"), "utf8")).version;
    assert.equal(installed("@buildanagent/sdk"), sdk.manifest.version);
    assert.equal(installed("@buildanagent/gateway"), gateway.manifest.version);

    const requests = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({ url: request.url, headers: request.headers, body: JSON.parse(body) });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(STREAM);
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address();
      const { stdout } = await promisify(execFile)(process.execPath, ["call.mjs", `http://127.0.0.1:${port}`], {
        cwd: app,
        env,
        encoding: "utf8",
      });
      assert.deepEqual(JSON.parse(stdout), {
        content: [{ type: "text", text: "Hi from the mock" }],
        stopReason: "stop",
        output: 4,
      });
    } finally {
      server.close();
    }
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/v1/messages");
    assert.equal(requests[0].headers["x-api-key"], "sk-test-not-a-real-key");
    assert.equal(requests[0].body.model, "claude-opus-5-5");
  },
);

packTest("the packed CLI's buildanagent binary starts with a shebang and prints its help offline", () => {
  const { manifest, files, dest, tarball } = packed.get("@buildanagent/cli") ?? {};
  assert.ok(manifest, "the CLI was not packed");
  assert.deepEqual(manifest.bin, { buildanagent: "./dist/bin.js" });
  assert.ok(files.includes("dist/bin.js"), "the CLI packs no dist/bin.js");
  // pnpm's .bin link starts a .js file with Node whatever its first line says, but npm's is a plain symlink, which
  // the shell runs as a shell script unless the file names Node itself.
  const [first] = readFileSync(path.join(dest, "dist", "bin.js"), "utf8").split("\n");
  assert.equal(first, "#!/usr/bin/env node");
  const mode = run("tar", ["-tvzf", tarball, "package/dist/bin.js"]).split(/\s+/)[0];
  assert.match(mode, /^-rwx/, "the packed dist/bin.js is not executable");

  const app = path.join(work, "cli-project");
  mkdirSync(app);
  installTarballs(app, ["@buildanagent/cli"]);
  // Both ways a user's shell reaches it: pnpm's link in node_modules/.bin, and the installed file itself, as npm's
  // symlink runs it.
  for (const binary of [
    path.join(app, "node_modules", ".bin", "buildanagent"),
    path.join(app, "node_modules", "@buildanagent", "cli", "dist", "bin.js"),
  ]) {
    assert.match(run(binary, ["--help"], { cwd: app }), /^Usage: buildanagent/, binary);
  }
});
