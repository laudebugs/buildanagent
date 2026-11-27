// A project's `.mcp.json` starts nothing until the project is trusted and each server's config is pinned. The fixture
// project's server writes `marker.json` the moment it starts, so a missing marker proves the command never ran.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.deepEqual(result.servers, []);
    // The notice shows the exact command and args, so the person sees what trust would run.
    assert.equal(result.declared[0]?.command, "node");
    assert.deepEqual(result.declared[0]?.args, ["server.mjs"]);
    assert.deepEqual(result.declared[0]?.env, { PROJECT_TOKEN: "PROJECT_TOKEN" });
    assert.equal(result.declared[0]?.state, "new");
    assert.match(result.notices[0] ?? "", /"fixture" runs \["node","server\.mjs"\] in .*not trusted/);
    assert.deepEqual(asked.asked, [], "no secret is asked for on behalf of an untrusted project");
    const started = await start(result.servers);
    assert.deepEqual(started.statuses, []);
    assert.deepEqual(started.tools, []);
    assert.equal(ran(root), false, "the project's command never ran");
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
    assert.match(result.notices[0] ?? "", /no value for PROJECT_TOKEN/);
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
    const result = await loadProjectMcpServers(root, options(root, false, { headless: true, loadInHeadless: true }));
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
    await refused(server({ args: ["server.mjs‮"] }), /control character/);
    await refused(server({ args: ["a\nb"] }), /control character/);
    await refused({ mcpServers: { bad_name: { command: "node" } } }, /server name/);
    await refused({ mcpServers: { "a\u202eb": { command: "node" } } }, /name has a control character/);
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
