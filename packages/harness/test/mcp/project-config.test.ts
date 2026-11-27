// A project's `.mcp.json` starts nothing until the project is trusted and each server's config is pinned. The fixture
// project's server writes `marker.json` the moment it starts, so a missing marker proves the command never ran.
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isHarnessError } from "@buildanagent/harness";
import {
  loadProjectMcpServers,
  type ProjectMcpOptions,
  pinProjectMcpServer,
  readMcpConfigPins,
  readMcpPins,
  realPathTrustStore,
  writeMcpPins,
} from "@buildanagent/harness/extensions/node";
import { createMcpManager, type McpServerConfig } from "@buildanagent/harness/mcp";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { afterAll, describe, test } from "vitest";

const FIXTURE = fileURLToPath(new URL("../fixtures/mcp-project", import.meta.url));
const TOKEN = "fixture-token-value";
/** The text a config writes to name a host value, `${NAME}`. */
const ref = (name: string) => `\${${name}}`;

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh copy of the fixture project, optionally with its `.mcp.json` replaced. */
function project(config?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "harness-mcp-project-"));
  dirs.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  if (config !== undefined) writeFileSync(join(root, ".mcp.json"), JSON.stringify(config));
  return root;
}

const ran = (root: string) => existsSync(join(root, "marker.json"));
const lockOf = (root: string) => join(root, ".agents", "extensions.lock.json");

/** A secrets resolver that answers only PROJECT_TOKEN and counts every question. */
function secrets() {
  const asked: string[] = [];
  return {
    asked,
    resolve: (reference: string) => {
      asked.push(reference);
      return reference === "PROJECT_TOKEN" ? TOKEN : undefined;
    },
  };
}

const options = (root: string, trusted: boolean, extra: Partial<ProjectMcpOptions> = {}): ProjectMcpOptions => ({
  trust: realPathTrustStore(trusted ? [root] : []),
  headless: false,
  ...extra,
});

/** Starts what the loader returned, as a host would, and resolves with the statuses and the registered tool names. */
async function start(servers: readonly McpServerConfig[]) {
  const registry = createToolRegistry();
  const manager = createMcpManager({ registry, servers });
  try {
    const statuses = await manager.connect();
    return { statuses, tools: registry.list().map((tool) => tool.canonicalName) };
  } finally {
    await manager.close();
  }
}

/** Pins every declared server as shown, as a person approving them would. */
async function pinAll(root: string): Promise<void> {
  const shown = await loadProjectMcpServers(root, options(root, true));
  for (const server of shown.declared) await pinProjectMcpServer(root, server.name, server.hash);
}

describe("project MCP configs: trust", () => {
  test("an untrusted project starts no server and registers no tool, even with matching pins", async () => {
    const root = project();
    await pinAll(root);
    const asked = secrets();
    const result = await loadProjectMcpServers(root, options(root, false, { secrets: asked.resolve }));
    // Whatever the loader returned is started, as a host would, so a gate that let a server through shows the marker.
    const started = await start(result.servers);
    assert.equal(ran(root), false, "the project's command never ran");
    assert.deepEqual(started.statuses, []);
    assert.deepEqual(started.tools, []);
    assert.deepEqual(asked.asked, [], "no secret is asked for on behalf of an untrusted project");
    // The notice shows the exact command and args, so the person sees what trust would run, and that the project's
    // own lock file would start it at once.
    assert.equal(result.declared[0]?.command, "node");
    assert.deepEqual(result.declared[0]?.args, ["server.mjs"]);
    assert.deepEqual(result.declared[0]?.env, { PROJECT_TOKEN: "PROJECT_TOKEN" });
    assert.equal(result.declared[0]?.state, "pinned");
    assert.match(result.notices[0] ?? "", /"fixture" runs \["node","server\.mjs"\] in .*not trusted/);
    assert.match(
      result.notices[0] ?? "",
      /its own lock file pins this config, so once the project is trusted it starts/,
    );
    assert.match(
      result.notices[0] ?? "",
      /not headless \(or sets loadInHeadless\), when the host supplies every variable/,
    );
  });

  test("an untrusted project without pins shows its servers as new", async () => {
    const root = project();
    const result = await loadProjectMcpServers(root, options(root, false));
    assert.equal(result.declared[0]?.state, "new");
    assert.match(result.notices[0] ?? "", /it is not started: the project is not trusted$/);
  });

  test("a trusted project with no pin starts nothing and waits for approval", async () => {
    const root = project();
    const result = await loadProjectMcpServers(root, options(root, true, { secrets: secrets().resolve }));
    assert.deepEqual(result.servers, []);
    assert.equal(result.declared[0]?.state, "new");
    assert.match(result.notices[0] ?? "", /not pinned, so it waits for approval/);
    await start(result.servers);
    assert.equal(ran(root), false);
  });

  test("a trusted, pinned server starts with the host's value and nothing else from the parent", async () => {
    const root = project();
    await pinAll(root);
    process.env.PROJECT_MCP_CANARY = "leaked";
    try {
      const result = await loadProjectMcpServers(root, options(root, true, { secrets: secrets().resolve }));
      assert.equal(result.servers.length, 1);
      const transport = result.servers[0]?.transport;
      assert.ok(transport?.kind === "stdio");
      assert.equal(transport.env, undefined, "a project config names no parent variable to copy");
      const started = await start(result.servers);
      assert.equal(started.statuses[0]?.status, "connected");
      assert.deepEqual(started.tools, ["mcp__fixture__echo"]);
      const { env } = JSON.parse(readFileSync(join(root, "marker.json"), "utf8")) as { env: Record<string, string> };
      assert.equal(env.PROJECT_TOKEN, TOKEN);
      assert.equal(env.PROJECT_MCP_CANARY, undefined);
      assert.notEqual(env.HOME, process.env.HOME);
    } finally {
      delete process.env.PROJECT_MCP_CANARY;
    }
  });

  test("a server whose variable the host does not supply does not start", async () => {
    const root = project();
    await pinAll(root);
    const result = await loadProjectMcpServers(root, options(root, true));
    assert.deepEqual(result.servers, []);
    assert.match(result.notices[0] ?? "", /no value for "PROJECT_TOKEN"/);
  });
});

describe("project MCP configs: pins", () => {
  test("the pin sits in the lock file under the server's name, beside its tool pins", async () => {
    const root = project();
    await pinAll(root);
    const tools = { echo: `sha256:${"a".repeat(64)}` };
    await writeMcpPins(lockOf(root), "fixture", tools);
    const pins = await readMcpConfigPins(lockOf(root));
    assert.match(pins.get("fixture") ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(await readMcpPins(lockOf(root), "fixture"), tools);
  });

  test("a config pin alone holds no tool pins", async () => {
    const root = project();
    await pinAll(root);
    assert.equal(await readMcpPins(lockOf(root), "fixture"), undefined);
  });

  test("changed args ask again and start nothing", async () => {
    const root = project();
    await pinAll(root);
    const config = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    config.mcpServers.fixture.args = ["server.mjs", "--extra"];
    writeFileSync(join(root, ".mcp.json"), JSON.stringify(config));
    const result = await loadProjectMcpServers(root, options(root, true, { secrets: secrets().resolve }));
    assert.deepEqual(result.servers, []);
    assert.equal(result.declared[0]?.state, "changed");
    assert.match(result.notices[0] ?? "", /\["node","server\.mjs","--extra"\].*changed since it was pinned/);
    await start(result.servers);
    assert.equal(ran(root), false);
  });

  test("a changed variable list asks again", async () => {
    const root = project();
    await pinAll(root);
    const config = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    config.mcpServers.fixture.env.OTHER = ref("OTHER");
    writeFileSync(join(root, ".mcp.json"), JSON.stringify(config));
    const result = await loadProjectMcpServers(root, options(root, true, { secrets: secrets().resolve }));
    assert.equal(result.declared[0]?.state, "changed");
  });

  test("a changed script that the command names asks again, with the same config", async () => {
    const root = project();
    await pinAll(root);
    const before = await loadProjectMcpServers(root, options(root, true, { secrets: secrets().resolve }));
    assert.deepEqual(Object.keys(before.declared[0]?.files ?? {}), ["server.mjs"]);
    writeFileSync(join(root, "server.mjs"), `${readFileSync(join(root, "server.mjs"), "utf8")}\n// changed\n`);
    const result = await loadProjectMcpServers(root, options(root, true, { secrets: secrets().resolve }));
    assert.deepEqual(result.servers, []);
    assert.equal(result.declared[0]?.state, "changed");
  });

  test("a pin is refused for a hash the config no longer has, and for a server it does not declare", async () => {
    const root = project();
    const shown = await loadProjectMcpServers(root, options(root, false));
    writeFileSync(join(root, "server.mjs"), "// replaced\n");
    await assert.rejects(pinProjectMcpServer(root, "fixture", shown.declared[0]?.hash as string), (error) => {
      return isHarnessError(error) && error.code === "invalid_mcp_config" && /changed since/.test(error.message);
    });
    await assert.rejects(pinProjectMcpServer(root, "nobody", shown.declared[0]?.hash as string), /no stdio MCP server/);
    assert.deepEqual(await readMcpConfigPins(lockOf(root)), new Map());
  });
});

describe("project MCP configs: headless", () => {
  test("a headless run starts nothing without the opt-in, even trusted and pinned", async () => {
    const root = project();
    await pinAll(root);
    const asked = secrets();
    const result = await loadProjectMcpServers(root, options(root, true, { headless: true, secrets: asked.resolve }));
    assert.deepEqual(result.servers, []);
    assert.deepEqual(result.declared, []);
    assert.match(result.notices[0] ?? "", /headless/);
    assert.deepEqual(asked.asked, []);
    await start(result.servers);
    assert.equal(ran(root), false);
  });

  test("with the opt-in, a headless run starts a trusted project's pinned servers", async () => {
    const root = project();
    await pinAll(root);
    const result = await loadProjectMcpServers(
      root,
      options(root, true, { headless: true, loadInHeadless: true, secrets: secrets().resolve }),
    );
    assert.equal(result.servers.length, 1);
  });

  test("with the opt-in, an untrusted project still starts nothing", async () => {
    const root = project();
    await pinAll(root);
    const result = await loadProjectMcpServers(
      root,
      options(root, false, { headless: true, loadInHeadless: true, secrets: secrets().resolve }),
    );
    await start(result.servers);
    assert.equal(ran(root), false);
    assert.deepEqual(result.servers, []);
  });
});

/** Expects the config to be refused with `invalid_mcp_config`, before anything ran. */
async function refused(config: unknown, why: RegExp, secretText?: string): Promise<void> {
  const root = project(config);
  await assert.rejects(loadProjectMcpServers(root, options(root, true, { secrets: secrets().resolve })), (error) => {
    assert.ok(isHarnessError(error) && error.code === "invalid_mcp_config", String(error));
    assert.match(error.message, why);
    if (secretText !== undefined) assert.ok(!error.message.includes(secretText), "the refusal never quotes the value");
    return true;
  });
  assert.equal(ran(root), false);
}

const server = (fields: Record<string, unknown>) => ({
  mcpServers: { fixture: { command: "node", args: ["server.mjs"], ...fields } },
});

describe("project MCP configs: credentials and the environment", () => {
  test("a credential's value in the file is refused, and the refusal does not repeat it", async () => {
    await refused(server({ env: { GITHUB_TOKEN: "ghp_secretvalue123" } }), /never holds a value/, "ghp_secretvalue123");
  });

  test("a value under a name that does not look like a credential is refused too", async () => {
    await refused(server({ env: { SETTING: "plain" } }), /sets "SETTING" to a value/, "plain");
  });

  test("a reference with anything around it is a value, and refused", async () => {
    await refused(server({ env: { AUTH_HEADER: `Bearer ${ref("TOKEN")}` } }), /never holds a value/, "Bearer");
  });

  test("a variable spawnEnv() sets, or one that changes what a program loads, is refused", async () => {
    await refused(server({ env: { PATH: ref("PATH") } }), /can't set "PATH"/);
    await refused(server({ env: { HOME: ref("X") } }), /can't set "HOME"/);
    await refused(
      server({ env: { NODE_OPTIONS: ref("X") } }),
      /can't set "NODE_OPTIONS": .*changes what a program loads/,
    );
    await refused(server({ env: { LD_PRELOAD: ref("X") } }), /can't set "LD_PRELOAD"/);
  });

  test("an expansion in the command or args is refused, since it would read the host's variables", async () => {
    await refused(server({ args: ["server.mjs", `--token=${ref("GITHUB_TOKEN")}`] }), /\$\{…\} in its args/);
    await refused({ mcpServers: { fixture: { command: ref("SHELL") } } }, /\$\{…\} in its command/);
  });
});

describe("project MCP configs: the file", () => {
  test("a remote entry is skipped with a notice, and the stdio entries still load", async () => {
    const root = project({
      mcpServers: {
        docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: ref("DOCS_TOKEN") } },
        fixture: { command: "node", args: ["server.mjs"] },
      },
    });
    await pinAll(root);
    const result = await loadProjectMcpServers(root, options(root, true));
    assert.deepEqual(
      result.servers.map((config) => config.name),
      ["fixture"],
    );
    assert.match(result.notices[0] ?? "", /"docs" .* skipped: a project config loads stdio servers only/);
  });

  test("an unknown member, a control character or a bad name is refused", async () => {
    await refused(server({ cwd: "/" }), /member "cwd"/);
    await refused(server({ args: ["server.mjs‮"] }), /hidden or look-alike character in its args/);
    await refused(server({ args: ["a\nb"] }), /hidden or look-alike character/);
    await refused({ mcpServers: { bad_name: { command: "node" } } }, /server name/);
    await refused({ mcpServers: { "a\u202eb": { command: "node" } } }, /hidden or look-alike character in its name/);
    await refused({ mcpServers: { Fixture: { command: "node" }, fixture: { command: "node" } } }, /two MCP servers/);
    await refused({ servers: {} }, /no "mcpServers" object/);
  });

  test("a project without .mcp.json gives nothing and says nothing", async () => {
    const root = project();
    rmSync(join(root, ".mcp.json"));
    assert.deepEqual(await loadProjectMcpServers(root, options(root, false)), {
      servers: [],
      declared: [],
      notices: [],
    });
  });
});

describe("project MCP configs: what the pin covers", () => {
  /** The paths the pin hashes for a config, in a fresh project with `files` written first. */
  async function pinned(config: unknown, files: Record<string, string> = {}, trusted = true) {
    const root = project(config);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await loadProjectMcpServers(root, options(root, trusted));
    return { root, files: result.declared[0]?.files ?? {}, hash: result.declared[0]?.hash };
  }

  test("a file named in an --option=value argument is hashed", async () => {
    for (const flag of ["--import", "--require", "-r", "--loader"]) {
      const { files } = await pinned(server({ args: [`${flag}=./p.mjs`, "server.mjs"] }), { "p.mjs": "1" });
      assert.deepEqual(Object.keys(files).sort(), ["p.mjs", "server.mjs"], flag);
    }
  });

  test("a folder inside the project is hashed whole, so a file added to it asks again", async () => {
    const config = server({ args: ["./srv/"] });
    const { root, files, hash } = await pinned(config, { "srv/index.mjs": "1" });
    assert.deepEqual(Object.keys(files), ["srv"]);
    writeFileSync(join(root, "srv", "extra.mjs"), "2");
    const again = await loadProjectMcpServers(root, options(root, true));
    assert.notEqual(again.declared[0]?.hash, hash);
  });

  test("the root and a module named by name are not hashed", async () => {
    const { files } = await pinned(server({ command: "python3", args: ["-m", "pkg", "."] }), { "pkg/__init__.py": "" });
    // `-m pkg` names a module, not a path: `pkg` is hashed only because a folder of that name happens to be here.
    assert.deepEqual(Object.keys(files), ["pkg"]);
  });

  test("a link out of the project is refused before its target is read, even untrusted", async () => {
    const outside = mkdtempSync(join(tmpdir(), "harness-mcp-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "secret.txt"), "outside");
    const root = project(server({ args: ["linked.mjs"] }));
    symlinkSync(join(outside, "secret.txt"), join(root, "linked.mjs"));
    await assert.rejects(loadProjectMcpServers(root, options(root, false)), (error) => {
      return isHarnessError(error) && error.code === "invalid_mcp_config" && /outside the project/.test(error.message);
    });
  });

  test("a folder holding a link is refused", async () => {
    const root = project(server({ args: ["./srv"] }));
    mkdirSync(join(root, "srv"));
    symlinkSync(join(root, "server.mjs"), join(root, "srv", "inner.mjs"));
    await assert.rejects(loadProjectMcpServers(root, options(root, true)), /is a link, or holds one/);
  });

  test("a path named many times is hashed once, and too much to hash is refused", async () => {
    // 40 copies of a 2 MiB file would be 80 MiB, over the 64 MiB a load may hash, if each were read.
    const repeated = await pinned(server({ args: Array.from({ length: 40 }, () => "two.bin") }), {
      "two.bin": "x".repeat(2 * 1024 * 1024),
    });
    assert.deepEqual(Object.keys(repeated.files), ["two.bin"]);
    const root = project(server({ args: ["big.bin"] }));
    writeFileSync(join(root, "big.bin"), new Uint8Array(16 * 1024 * 1024 + 1));
    await assert.rejects(loadProjectMcpServers(root, options(root, false)), /over what a pin covers/);
    await refused(server({ args: Array.from({ length: 65 }, () => "x") }), /more than 64 args/);
    await refused(server({ args: ["x".repeat(1025)] }), /over 1024 characters/);
  });

  test("a linked .agents folder is refused, so a pin is never written outside the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "harness-mcp-outside-"));
    dirs.push(outside);
    const root = project();
    symlinkSync(outside, join(root, ".agents"));
    const shown = await loadProjectMcpServers(root, options(root, false)).catch((error: unknown) => error);
    assert.ok(isHarnessError(shown) && /outside the project/.test(shown.message));
    await assert.rejects(pinProjectMcpServer(root, "fixture", `sha256:${"0".repeat(64)}`), /outside the project/);
    assert.equal(existsSync(join(outside, "extensions.lock.json")), false);
  });
});

describe("project MCP configs: the notice and the refusals", () => {
  test("separators, non-ASCII spaces and combining marks are refused", async () => {
    for (const arg of ["x\u2028y", "x\u2029y", "x\u3000y", "x\u00a0y", "x\u0336y", "x\u20dd"]) {
      await refused(server({ args: [arg] }), /hidden or look-alike character/);
    }
  });

  test("a refusal escapes what the project wrote", async () => {
    await refused(server({ env: { "A\u202eB": ref("X") } }), /"A\\u202eB"/);
    await refused({ mcpServers: { fixture: { command: "node", "\u202eevil": 1 } } }, /"\\u202eevil"/);
    const root = project(server({ env: { "A\u202eB": ref("X") } }));
    const error = await loadProjectMcpServers(root, options(root, false)).catch((caught: unknown) => caught);
    assert.ok(error instanceof Error && !error.message.includes("\u202e"));
  });

  test("more refused variable names: loader and configuration families", async () => {
    for (const name of [
      "DYLD_FRAMEWORK_PATH",
      "DYLD_FALLBACK_LIBRARY_PATH",
      "JAVA_TOOL_OPTIONS",
      "PERL5LIB",
      "RUBYLIB",
      "PYTHONHOME",
      "GIT_CONFIG_PARAMETERS",
      "NODE_REPL_EXTERNAL_MODULE",
      "npm_config_registry",
      "ZDOTDIR",
      "LD_AUDIT",
    ]) {
      await refused(server({ env: { [name]: ref("X") } }), /changes what a program loads or how it is configured/);
    }
  });

  test("a corrupt lock file and a bad server name are invalid_mcp_config, named by the file", async () => {
    const root = project();
    mkdirSync(join(root, ".agents"));
    writeFileSync(lockOf(root), "<<<<<<< conflict");
    await assert.rejects(loadProjectMcpServers(root, options(root, true)), (error) => {
      return isHarnessError(error) && error.code === "invalid_mcp_config" && error.message.includes(lockOf(root));
    });
    await refused({ mcpServers: { bad_name: { command: "node" } } }, /\.mcp\.json": an MCP server name/);
  });
});

describe("project MCP configs: round 2", () => {
  test("a folder's walk stops at the cap, before it is listed whole, and empty folders count", async () => {
    const root = project(server({ args: ["d"] }));
    for (let i = 0; i < 4100; i++) mkdirSync(join(root, "d", `e${i}`), { recursive: true });
    await assert.rejects(loadProjectMcpServers(root, options(root, false)), /over what a pin covers/);
  });

  test("two spellings of one file are one entry, keyed by its real path", async () => {
    const root = project(server({ args: ["server.mjs", "./server.mjs", "x/../server.mjs"] }));
    const result = await loadProjectMcpServers(root, options(root, false));
    assert.deepEqual(Object.keys(result.declared[0]?.files ?? {}), ["server.mjs"]);
  });

  test("a project path written through a link to the project is pinned like its real spelling", async () => {
    const real = project();
    const linkParent = mkdtempSync(join(tmpdir(), "harness-mcp-alias-"));
    dirs.push(linkParent);
    const alias = join(linkParent, "alias");
    symlinkSync(real, alias);
    const write = (path: string) => writeFileSync(join(real, ".mcp.json"), JSON.stringify(server({ args: [path] })));
    write(join(alias, "server.mjs"));
    const viaAlias = await loadProjectMcpServers(real, options(real, false));
    write(join(realpathSync(real), "server.mjs"));
    const viaReal = await loadProjectMcpServers(real, options(real, false));
    assert.deepEqual(Object.keys(viaAlias.declared[0]?.files ?? {}), ["server.mjs"]);
    assert.deepEqual(viaAlias.declared[0]?.files, viaReal.declared[0]?.files);
  });

  test("a link out of the project written through an alias of the project is still refused", async () => {
    const outside = mkdtempSync(join(tmpdir(), "harness-mcp-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "secret.txt"), "outside");
    const real = project();
    symlinkSync(join(outside, "secret.txt"), join(real, "linked.mjs"));
    const linkParent = mkdtempSync(join(tmpdir(), "harness-mcp-alias-"));
    dirs.push(linkParent);
    symlinkSync(real, join(linkParent, "alias"));
    writeFileSync(join(real, ".mcp.json"), JSON.stringify(server({ args: [join(linkParent, "alias", "linked.mjs")] })));
    await assert.rejects(loadProjectMcpServers(real, options(real, false)), /outside the project/);
  });

  test("a .agents link that leads nowhere is refused, not left to fail on the write", async () => {
    const root = project();
    symlinkSync(join(root, "missing-target"), join(root, ".agents"));
    const shown = await loadProjectMcpServers(root, options(root, false)).catch((error: unknown) => error);
    assert.ok(isHarnessError(shown) && shown.code === "invalid_mcp_config" && /leads nowhere/.test(shown.message));
    await assert.rejects(pinProjectMcpServer(root, "fixture", `sha256:${"0".repeat(64)}`), (error) => {
      return isHarnessError(error) && error.code === "invalid_mcp_config" && /leads nowhere/.test(error.message);
    });
  });

  test("a wrapped refusal keeps its cause", async () => {
    const root = project(server({ args: ["./srv"] }));
    mkdirSync(join(root, "srv"));
    symlinkSync(join(root, "server.mjs"), join(root, "srv", "inner.mjs"));
    const error = await loadProjectMcpServers(root, options(root, true)).catch((caught: unknown) => caught);
    assert.ok(error instanceof Error && error.cause instanceof Error);
  });
});

describe("project MCP configs: a path that leaves the project partway along", () => {
  /** A folder outside the project holding `x.mjs`. */
  function outsideFolder(): string {
    const outside = mkdtempSync(join(tmpdir(), "harness-mcp-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "x.mjs"), "outside");
    return outside;
  }

  test("a folder link out of the project partway along the path is refused", async () => {
    const outside = outsideFolder();
    const root = project(server({ args: ["lib/x.mjs"] }));
    symlinkSync(outside, join(root, "lib"));
    await assert.rejects(loadProjectMcpServers(root, options(root, false)), (error) => {
      return isHarnessError(error) && error.code === "invalid_mcp_config" && /outside the project/.test(error.message);
    });
  });

  test("a link out of the project in the last part of the path is refused", async () => {
    const outside = outsideFolder();
    const root = project(server({ args: ["y.mjs"] }));
    symlinkSync(join(outside, "x.mjs"), join(root, "y.mjs"));
    await assert.rejects(loadProjectMcpServers(root, options(root, false)), /outside the project/);
  });

  test("the root's other spelling, as /var for /private/var, is pinned, and a folder link out under it refused", async () => {
    const root = project();
    const given = join(root, "."); // as the caller wrote it, which on macOS is under /var, not /private/var
    writeFileSync(join(root, ".mcp.json"), JSON.stringify(server({ args: [join(given, "server.mjs")] })));
    const result = await loadProjectMcpServers(given, options(root, false));
    assert.deepEqual(Object.keys(result.declared[0]?.files ?? {}), ["server.mjs"]);
    symlinkSync(outsideFolder(), join(root, "lib"));
    writeFileSync(join(root, ".mcp.json"), JSON.stringify(server({ args: [join(given, "lib", "x.mjs")] })));
    await assert.rejects(loadProjectMcpServers(given, options(root, false)), /outside the project/);
  });

  test("an absolute path outside the project is skipped, not hashed or refused", async () => {
    const outside = outsideFolder();
    const root = project(server({ args: [join(outside, "x.mjs"), process.execPath] }));
    const result = await loadProjectMcpServers(root, options(root, false));
    assert.deepEqual(result.declared[0]?.files, {});
  });
});
