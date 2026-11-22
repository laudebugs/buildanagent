// Long-lived streams: the legacy SSE stream, the streamable HTTP GET stream and the 2026-07-28 listen stream. The
// harness's own idle, lifetime and byte cuts end such a stream on purpose, so a cut must never close a connection that
// can't reopen it, and must never count against the budget that stops a server from looping the client.
import assert from "node:assert/strict";
import { connectMcpServer, createMcpManager } from "@buildanagent/harness/mcp";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, test } from "vitest";
import { eventually } from "./helpers.js";
import { libraryHttp, manualTimers, remoteServer } from "./http-helpers.js";
import { legacyHttp, legacySse, rawTool } from "./raw-http.js";
import { schema } from "./turns.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const signal = () => new AbortController().signal;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the legacy SSE stream", () => {
  test("outlives streamIdleMs, maxStreamMs and maxStreamBytes, since nothing could open it again", async () => {
    const server = await legacySse({ tools: [rawTool("a")] });
    const lines: string[] = [];
    const connection = await connectMcpServer(
      remoteServer("sse", server.url, {
        transport: { kind: "sse", streamIdleMs: 150, maxStreamMs: 400, maxStreamBytes: 2000 },
      }),
      { log: (line) => lines.push(line) },
    );
    closers.push(() => connection.close());
    // Each call's answer comes on the stream, so a few of them pass maxStreamBytes in all.
    for (let call = 0; call < 12; call += 1) await connection.callTool("a", { echo: "x".repeat(200) }, signal());
    await pause(4500);
    assert.ok(!connection.closed, lines.join("\n"));
    assert.deepEqual((await connection.callTool("a", {}, signal())).content, [{ type: "text", text: "called a" }]);
    assert.equal(server.seen.filter((request) => request.method === "GET").length, 1);
  }, 15_000);

  test("still closes the connection on an event over maxMessageBytes", async () => {
    const server = await legacySse({ tools: [rawTool("a")] });
    const lines: string[] = [];
    const connection = await connectMcpServer(
      remoteServer("sse", server.url, { transport: { kind: "sse", maxMessageBytes: 4000 } }),
      { log: (line) => lines.push(line) },
    );
    closers.push(() => connection.close());
    await assert.rejects(connection.callTool("a", { echo: "y".repeat(8000) }, signal()), /event over 4000 bytes/);
    assert.ok(connection.closed);
    assert.ok(
      lines.some((line) => line.includes("the connection was closed: the server sent an event over 4000 bytes")),
    );
  });
});

describe("a legacy SSE GET that is not an event stream", () => {
  for (const [type, status] of [
    ["text/plain", 200],
    ["text/html", 500],
  ] as const) {
    test(`a ${status} ${type} body that drips forever is bounded like any answer`, async () => {
      let ended = false;
      const server = await legacySse({
        tools: [],
        hook: (request, response) => {
          if (request.method !== "GET") return false;
          response.writeHead(status, { "content-type": type });
          const timer = setInterval(() => response.write("."), 20);
          response.once("close", () => {
            clearInterval(timer);
            ended = true;
          });
          return true;
        },
      });
      const started = Date.now();
      const error = await connectMcpServer(
        remoteServer("drip", server.url, { transport: { kind: "sse", maxStreamMs: 300 }, connectTimeoutMs: 20_000 }),
      ).then(
        async (connection) => {
          await connection.close();
          return undefined;
        },
        (failure: unknown) => failure as Error,
      );
      assert.ok(error !== undefined);
      assert.ok(Date.now() - started < 5000, `the connect took ${Date.now() - started} ms`);
      // The body is cut, so the server's socket closes and its drip holds nothing open.
      assert.ok(await eventually(() => ended, 3000), "the dripping body was never cut");
    }, 25_000);
  }
});

describe("the streamable HTTP GET stream", () => {
  test("a quiet stream cut at streamIdleMs is opened again, and the cuts never use up the reopen budget", async () => {
    let gets = 0;
    const server = await legacyHttp({
      tools: [rawTool("a")],
      hook: (request, response) => {
        if (request.method !== "GET") return false;
        gets += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(": open\n\n");
        return true;
      },
    });
    const timers = manualTimers();
    const lines: string[] = [];
    const connection = await connectMcpServer(remoteServer("quiet", server.url, { transport: { streamIdleMs: 100 } }), {
      timers,
      log: (line) => lines.push(line),
    });
    closers.push(() => connection.close());
    for (let cut = 1; cut <= 14; cut += 1) {
      assert.ok(await eventually(() => gets === cut, 2000), `stream ${cut} opened (${lines.join(" | ")})`);
      assert.ok(await eventually(() => timers.pending() > 0, 2000));
      await timers.advance(1000);
    }
    assert.ok(!connection.closed, lines.join("\n"));
  }, 30_000);

  test("a stream past maxStreamBytes in all is cut and opened again, and the connection stays", async () => {
    let gets = 0;
    const server = await legacyHttp({
      tools: [rawTool("a")],
      hook: (request, response) => {
        if (request.method !== "GET") return false;
        gets += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (let index = 0; index < 10; index += 1) response.write(`: ${"n".repeat(300)}\n\n`);
        return true;
      },
    });
    const timers = manualTimers();
    const connection = await connectMcpServer(
      remoteServer("busy", server.url, { transport: { maxStreamBytes: 2000 } }),
      { timers },
    );
    closers.push(() => connection.close());
    assert.ok(await eventually(() => timers.pending() > 0, 2000));
    await timers.advance(1000);
    assert.ok(await eventually(() => gets === 2, 2000));
    assert.ok(!connection.closed);
  });

  test("a stream whose reopens keep failing closes the connection once the budget is spent", async () => {
    let gets = 0;
    const server = await legacyHttp({
      tools: [],
      hook: (request, response) => {
        if (request.method !== "GET") return false;
        gets += 1;
        if (gets === 1) {
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(": bye\n\n");
        } else response.writeHead(500).end();
        return true;
      },
    });
    const timers = manualTimers();
    const lines: string[] = [];
    const connection = await connectMcpServer(remoteServer("failing", server.url), {
      timers,
      log: (line) => lines.push(line),
    });
    closers.push(() => connection.close());
    for (let round = 0; round < 20 && !connection.closed; round += 1) {
      await eventually(() => timers.pending() > 0 || connection.closed, 1000);
      await timers.advance(30_000);
    }
    assert.ok(connection.closed, `${gets} GETs; ${lines.join(" | ")}`);
    assert.ok(lines.some((line) => line.includes("dropped 10 times in ten minutes")));
  }, 30_000);
});

describe("the 2026-07-28 listen stream", () => {
  test("a quiet listen cut at streamIdleMs is opened again, and the cuts don't count as drops", async () => {
    const server = await libraryHttp(() => {
      const mcp = new McpServer({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
      mcp.registerTool("look", { description: "Looks.", inputSchema: schema({ type: "object" }) }, (async () => ({
        content: [],
      })) as never);
      return mcp;
    });
    const timers = manualTimers();
    const lines: string[] = [];
    const manager = createMcpManager({
      registry: createToolRegistry(),
      servers: [remoteServer("modern", server.url, { transport: { streamIdleMs: 100 } })],
      timers,
      log: (line) => lines.push(line),
    });
    closers.push(() => manager.close());
    await manager.connect();
    const listens = () => server.seen.filter((request) => request.rpc === "subscriptions/listen").length;
    const closes = () => lines.filter((line) => line.includes("the change stream of")).length;
    for (let opened = 1; opened <= 12; opened += 1) {
      assert.ok(await eventually(() => listens() === opened, 2000), `listen ${opened} (${lines.join(" | ")})`);
      // The library may first try to resume with a GET, which a 2026-07-28 server refuses, before the listen ends.
      for (let step = 0; step < 4 && closes() < opened; step += 1) {
        await eventually(() => closes() >= opened, 500);
        await timers.advance(1000);
      }
      await timers.advance(1000);
    }
    assert.ok(!lines.some((line) => line.includes("is not opened again")));
  }, 40_000);
});
