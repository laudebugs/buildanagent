// Per-server era negotiation: the client probes each server with `server/discover` and falls back to `initialize`
// on its own, so a 2026-07-28 server and a legacy one connect side by side in one harness, each in its own era.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { connectMcpServer, createMcpManager, type McpChannel, McpError } from "@buildanagent/harness/mcp";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { afterEach, describe, test } from "vitest";
import { callStep, doneStep, runMcpTurn, stdioServer, toolResults } from "./helpers.js";
import { serveLegacy, serveModern } from "./library-server.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** A channel that records the method of every request the client sends through it. */
function recording(channel: McpChannel): { channel: McpChannel; methods: string[] } {
  const methods: string[] = [];
  const send = channel.send.bind(channel);
  channel.send = async (message: object) => {
    const method = (message as { method?: unknown }).method;
    if (typeof method === "string") methods.push(method);
    return send(message);
  };
  return { channel, methods };
}

describe("an in-process server of each era", () => {
  test("a 2026-07-28 server answers the probe and connects in its era, with no initialize", async () => {
    const { channel, methods } = recording(serveModern() as unknown as McpChannel);
    const connection = await connectMcpServer({ name: "modern", transport: { kind: "in_process", channel } });
    closers.push(() => connection.close());
    assert.equal(connection.era, "2026-07-28");
    assert.equal(connection.protocolVersion, "2026-07-28");
    assert.equal(methods[0], "server/discover");
    assert.ok(!methods.includes("initialize"), `sent ${methods.join(", ")}`);
  });

  test("a legacy server refuses the probe, and the client falls back to initialize", async () => {
    const { channel, methods } = recording((await serveLegacy()) as unknown as McpChannel);
    const connection = await connectMcpServer({ name: "legacy", transport: { kind: "in_process", channel } });
    closers.push(() => connection.close());
    assert.equal(connection.era, "legacy");
    assert.equal(connection.protocolVersion, "2025-11-25");
    assert.deepEqual(methods.slice(0, 2), ["server/discover", "initialize"]);
  });

  test("both connect in one harness, each in its own era, and one turn calls a tool of each", async () => {
    const registry = createToolRegistry();
    const manager = createMcpManager({
      registry,
      servers: [
        { name: "modern", transport: { kind: "in_process", channel: serveModern() as unknown as McpChannel } },
        { name: "legacy", transport: { kind: "in_process", channel: (await serveLegacy()) as unknown as McpChannel } },
      ],
    });
    closers.push(() => manager.close());
    const statuses = await manager.connect();
    assert.deepEqual(
      statuses.map((status) =>
        status.status === "connected" ? [status.server, status.era] : [status.server, "failed"],
      ),
      [
        ["modern", "2026-07-28"],
        ["legacy", "legacy"],
      ],
    );
    assert.equal(manager.connection("modern")?.era, "2026-07-28");
    assert.equal(manager.connection("legacy")?.era, "legacy");
    const { entries } = await runMcpTurn(registry, [
      {
        content: [
          ...callStep("c1", "mcp__modern__echo", { text: "from modern" }).content,
          ...callStep("c2", "mcp__legacy__echo", { text: "from legacy" }).content,
        ],
      },
      doneStep,
    ]);
    const results = toolResults(entries);
    assert.deepEqual(results.get("c1"), { text: "from modern", isError: false });
    assert.deepEqual(results.get("c2"), { text: "from legacy", isError: false });
  });
});

describe("a stdio server of each era", () => {
  test("a 2026-07-28 child and a legacy child connect in one manager, each in its own era", async () => {
    const manager = createMcpManager({
      registry: createToolRegistry(),
      servers: [stdioServer("modern", "library", ["modern"]), stdioServer("legacy", "library", ["legacy"])],
    });
    closers.push(() => manager.close());
    const statuses = await manager.connect();
    assert.deepEqual(
      statuses.map((status) => (status.status === "connected" ? status.era : status.error.message)),
      ["2026-07-28", "legacy"],
    );
  });

  test("a server that exits on the probe is started again and spoken to as legacy", async () => {
    const logged: string[] = [];
    const connection = await connectMcpServer(stdioServer("old", "raw", ["exit-on-probe", "plain"]), {
      log: (line) => logged.push(line),
    });
    closers.push(() => connection.close());
    assert.equal(connection.era, "legacy");
    assert.ok(logged.some((line) => line.includes("started again as a legacy server")));
    const result = await connection.callTool("echo", {}, new AbortController().signal);
    assert.deepEqual(result.content, [{ type: "text", text: "called echo" }]);
  });

  test("a server that never answers the probe is treated as legacy once the probe times out", async () => {
    const connection = await connectMcpServer(
      stdioServer("quiet", "raw", ["silent-probe", "plain"], { probeTimeoutMs: 300 }),
    );
    closers.push(() => connection.close());
    assert.equal(connection.era, "legacy");
  });

  test("a hand-written 2026-07-28 server connects in its era", async () => {
    const connection = await connectMcpServer(stdioServer("raw", "raw", ["modern", "plain"]));
    closers.push(() => connection.close());
    assert.equal(connection.era, "2026-07-28");
  });
});

describe("a request for user input", () => {
  test("a legacy result, which has no resultType, counts as complete", async () => {
    const connection = await connectMcpServer(stdioServer("bare", "raw", ["legacy", "no-result-type"]));
    closers.push(() => connection.close());
    assert.equal(connection.era, "legacy");
    const result = await connection.callTool("echo", {}, new AbortController().signal);
    assert.deepEqual(result, { content: [{ type: "text", text: "no resultType" }], isError: false });
  });

  test("a 2026-07-28 result without a resultType is refused as a server error, as the client library reads the spec", async () => {
    const connection = await connectMcpServer(stdioServer("bare", "raw", ["modern", "no-result-type"]));
    closers.push(() => connection.close());
    await assert.rejects(
      () => connection.callTool("echo", {}, new AbortController().signal),
      (error: unknown) =>
        error instanceof McpError && error.failure === "server_error" && /resultType/.test(error.message),
    );
  });

  test("fails the call with the input_required failure, since the harness supplies no input yet", async () => {
    const connection = await connectMcpServer(stdioServer("asks", "raw", ["modern", "input-required"]));
    closers.push(() => connection.close());
    assert.equal(connection.era, "2026-07-28");
    await assert.rejects(
      () => connection.callTool("echo", {}, new AbortController().signal),
      (error: unknown) =>
        error instanceof McpError &&
        isHarnessError(error) &&
        error.code === "mcp_call_failed" &&
        error.failure === "input_required" &&
        error.server === "asks",
    );
  });

  test("reaches the model as an error result that says the server asked for input", async () => {
    const registry = createToolRegistry();
    const manager = createMcpManager({ registry, servers: [stdioServer("asks", "raw", ["modern", "input-required"])] });
    closers.push(() => manager.close());
    const [status] = await manager.connect();
    assert.equal(status?.status, "connected", status?.status === "failed" ? status.error.message : "");
    const { entries } = await runMcpTurn(registry, [callStep("c1", "mcp__asks__echo"), doneStep]);
    const result = toolResults(entries).get("c1");
    assert.ok(result?.isError);
    assert.match(result.text, /asked for input from the user/);
  });
});
