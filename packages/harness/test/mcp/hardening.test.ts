// The MCP client against servers that end, race, signal or lie: each test here fails without the fix it names.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isHarnessError } from "@buildanagent/harness";
import { connectMcpServer, createMcpManager, McpError } from "@buildanagent/harness/mcp";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { afterEach, describe, test } from "vitest";
import { testEnv } from "../sandbox/home.js";
import { alive, callLog, eventually, stdioServer } from "./helpers.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const signal = () => new AbortController().signal;
const packageDir = fileURLToPath(new URL("../..", import.meta.url));
const host = fileURLToPath(new URL("./signal-host.ts", import.meta.url));
const rawScript = fileURLToPath(new URL("./raw-server.ts", import.meta.url));
const sourceCondition = fileURLToPath(new URL("../permissions/source-condition.mjs", import.meta.url));

describe("a server that exits", () => {
  test("still delivers output that arrives after its exit", async () => {
    const connection = await connectMcpServer(stdioServer("late", "raw", ["legacy", "late-output"]));
    closers.push(() => connection.close());
    assert.deepEqual((await connection.callTool("echo", {}, signal())).content, [{ type: "text", text: "late" }]);
  });

  test("still delivers a result it wrote just before it exited", async () => {
    const connection = await connectMcpServer(stdioServer("quick", "raw", ["legacy", "answer-then-exit"]));
    closers.push(() => connection.close());
    const result = await connection.callTool("echo", {}, signal());
    const [block] = result.content;
    assert.equal(block?.type === "text" ? block.text.length : 0, 32 * 1024);
  });

  test("that crashes at start is started once, not again as legacy", async () => {
    const log = callLog();
    const logged: string[] = [];
    await assert.rejects(
      () =>
        connectMcpServer(stdioServer("dead", "raw", ["legacy", "exit-on-start", log.path]), {
          log: (l) => logged.push(l),
        }),
      (error: unknown) => error instanceof McpError && error.code === "mcp_connect_failed",
    );
    assert.ok(!logged.some((line) => line.includes("started again")), logged.join("\n"));
  });

  test("that exits on the probe is started again within one connect timeout", async () => {
    const started = Date.now();
    const connection = await connectMcpServer(
      stdioServer("old", "raw", ["exit-on-probe", "plain"], { connectTimeoutMs: 20_000 }),
    );
    closers.push(() => connection.close());
    assert.equal(connection.era, "legacy");
    assert.ok(Date.now() - started < 20_000);
  });
});

describe("the harness's own signals", () => {
  function runHost(mode: string) {
    const child = spawn(
      process.execPath,
      ["--conditions=source", "--import", sourceCondition, "--import", "tsx", host, mode, rawScript],
      { cwd: packageDir, env: testEnv([]), stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on("exit", (code, sig) => resolve({ code, signal: sig })),
    );
    const ready = async () => {
      assert.ok(await eventually(() => /ready \d+/.test(out), 15_000), `host never got ready: ${err}`);
      return Number(/ready (\d+)/.exec(out)?.[1]);
    };
    return { child, exited, ready };
  }

  test("a SIGTERM that ends the host kills a server that ignores SIGTERM, and the host still dies by it", async () => {
    const { child, exited, ready } = runHost("plain");
    const server = await ready();
    assert.ok(alive(server));
    child.kill("SIGTERM");
    const exit = await exited;
    assert.equal(exit.signal, "SIGTERM");
    assert.ok(await eventually(() => !alive(server)), "the server outlived its host");
  }, 30_000);

  test("a host with its own SIGTERM listener keeps control, and its close ends the server", async () => {
    const { child, exited, ready } = runHost("own-handler");
    const server = await ready();
    child.kill("SIGTERM");
    const exit = await exited;
    assert.equal(exit.code, 0);
    assert.ok(await eventually(() => !alive(server)));
  }, 30_000);
});

describe("registration is all or none against the real registry", () => {
  test("a clash with a tool already registered leaves none of the server's tools behind", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "holder",
      source: "mcp:other",
      alias: "mcp__lib__echo",
      definition: defineTool({
        name: "holder",
        description: "Holds an alias.",
        inputSchema: { type: "object" },
        execute: async () => ({ content: [] }),
      }) as never,
    });
    const manager = createMcpManager({ registry, servers: [stdioServer("lib", "raw", ["legacy", "two-tools"])] });
    closers.push(() => manager.close());
    const [status] = await manager.connect();
    assert.ok(
      status?.status === "failed" && isHarnessError(status.error) && status.error.code === "mcp_tool_list_refused",
    );
    assert.deepEqual(
      registry.list().map((tool) => tool.canonicalName),
      ["mcp__other__holder"],
    );
  });

  test("two managers on one registry racing for one server name leave only the winner's tools", async () => {
    const registry = createToolRegistry();
    const first = createMcpManager({ registry, servers: [stdioServer("lib", "raw", ["legacy", "plain"])] });
    const second = createMcpManager({ registry, servers: [stdioServer("lib", "raw", ["legacy", "two-tools"])] });
    closers.push(
      () => first.close(),
      () => second.close(),
    );
    const [[a], [b]] = await Promise.all([first.connect(), second.connect()]);
    const statuses = [a?.status, b?.status].sort();
    assert.deepEqual(statuses, ["connected", "failed"]);
    const winner = a?.status === "connected" ? a : b;
    assert.deepEqual(
      registry.list().map((tool) => tool.canonicalName),
      winner?.status === "connected" ? winner.tools : [],
    );
  });
});

describe("config checks", () => {
  test("a refused variable name is an invalid MCP config", () => {
    assert.throws(
      () =>
        createMcpManager({
          registry: createToolRegistry(),
          servers: [stdioServer("lib", "library", ["legacy"], { transport: { env: ["GITHUB_TOKEN"] } })],
        }),
      (error: unknown) =>
        isHarnessError(error) && error.code === "invalid_mcp_config" && /GITHUB_TOKEN/.test(error.message),
    );
  });

  test("a probe timeout as long as the connect timeout is refused", () => {
    assert.throws(
      () =>
        createMcpManager({
          registry: createToolRegistry(),
          servers: [stdioServer("lib", "library", ["legacy"], { connectTimeoutMs: 3000, probeTimeoutMs: 3000 })],
        }),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_mcp_config",
    );
  });

  test("with a short connect timeout, the default probe shrinks so a silent probe still falls back to legacy", async () => {
    const connection = await connectMcpServer(
      stdioServer("quiet", "raw", ["silent-probe", "plain"], { connectTimeoutMs: 3000 }),
    );
    closers.push(() => connection.close());
    assert.equal(connection.era, "legacy");
  });
});

describe("closing the manager", () => {
  test("ends a hung handshake at once and closes the healthy servers without waiting for it", async () => {
    const manager = createMcpManager({
      registry: createToolRegistry(),
      servers: [
        stdioServer("silent", "raw", ["legacy", "silent"], { connectTimeoutMs: 25_000 }),
        stdioServer("lib", "library", ["legacy"]),
      ],
    });
    const connecting = manager.connect();
    assert.ok(await eventually(() => manager.connection("lib") !== undefined, 10_000));
    const [block] = (await manager.connection("lib")?.callTool("env", {}, signal()))?.content ?? [];
    const { pid } = JSON.parse(block?.type === "text" ? block.text : "{}") as { pid: number };
    const started = Date.now();
    await manager.close();
    assert.ok(Date.now() - started < 5000, `close took ${Date.now() - started} ms`);
    assert.ok(!alive(pid));
    const statuses = await connecting;
    assert.equal(statuses[0]?.status, "failed");
  }, 30_000);
});

describe("self-audit: hostile data", () => {
  test("__proto__ keys in a tool list and a result pollute nothing and change no field", async () => {
    const registry = createToolRegistry();
    const manager = createMcpManager({ registry, servers: [stdioServer("raw", "raw", ["legacy", "proto"])] });
    closers.push(() => manager.close());
    const [status] = await manager.connect();
    assert.equal(status?.status, "connected", status?.status === "failed" ? status.error.message : "");
    const result = await manager.connection("raw")?.callTool("p", {}, signal());
    assert.deepEqual(result, { content: [{ type: "text", text: "ok" }], isError: false });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("a character split across two writes is read whole", async () => {
    const connection = await connectMcpServer(stdioServer("raw", "raw", ["legacy", "split-utf8"]));
    closers.push(() => connection.close());
    assert.deepEqual((await connection.callTool("echo", {}, signal())).content, [{ type: "text", text: "héllo" }]);
  });

  test("an output schema with a catastrophic pattern is never compiled or run", async () => {
    const connection = await connectMcpServer(stdioServer("raw", "raw", ["legacy", "redos-output"]));
    closers.push(() => connection.close());
    // Listing the tools fills the client's cache of output schemas, which is what it would validate against.
    assert.equal((await connection.listTools()).length, 1);
    const started = Date.now();
    const result = await connection.callTool("r", {}, signal());
    assert.deepEqual(result.content, [{ type: "text", text: "done" }]);
    assert.ok(Date.now() - started < 2000);
  });

  test("a legacy server's sampling, roots and elicitation requests are refused with -32601, and ping is answered", async () => {
    const connection = await connectMcpServer(stdioServer("asker", "raw", ["legacy", "server-requests"]));
    closers.push(() => connection.close());
    const [block] = (await connection.callTool("echo", {}, signal())).content;
    const notFound = { error: { code: -32601, message: "Method not found" } };
    assert.deepEqual(JSON.parse(block?.type === "text" ? block.text : "{}"), {
      "sampling/createMessage": notFound,
      "roots/list": notFound,
      "elicitation/create": notFound,
      ping: { result: {} },
    });
  });

  test("a 2026-07-28 server's requests to the client are dropped unanswered", async () => {
    const connection = await connectMcpServer(stdioServer("asker", "raw", ["modern", "server-requests"]));
    closers.push(() => connection.close());
    assert.deepEqual((await connection.callTool("echo", {}, signal())).content, [{ type: "text", text: "{}" }]);
  });
});
