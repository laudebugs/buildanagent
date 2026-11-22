// Background connect: servers connect while the session runs, the first turn waits up to ten seconds only for
// `direct` servers, and a server that arrives late joins at a turn boundary without changing the tools a request sends.
// The waits run on a manual clock, so the ten- and thirty-second cases take milliseconds.
import assert from "node:assert/strict";
import { createMcpManager } from "@buildanagent/harness/mcp";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, test } from "vitest";
import { doneStep, eventually } from "./helpers.js";
import { gate, libraryHttp, manualTimers, remoteServer, startHttp } from "./http-helpers.js";
import { legacyHttp, rawTool } from "./raw-http.js";
import { mcpSession, requestTools, schema } from "./turns.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const names = (tools: readonly { name: string }[] | undefined) => (tools ?? []).map((tool) => tool.name);

describe("the first turn", () => {
  test("a deferred server that takes 30 s to answer does not delay the first model call", async () => {
    const timers = manualTimers();
    const slow = gate();
    const late = await legacyHttp({ tools: [rawTool("later")], hold: slow.promise });
    const quick = await legacyHttp({ tools: [rawTool("now")] });
    const registry = createToolRegistry();
    const manager = createMcpManager({
      registry,
      servers: [remoteServer("quick", quick.url, { exposure: "direct" }), remoteServer("late", late.url)],
      timers,
    });
    closers.push(() => manager.close());
    const session = await mcpSession(registry, manager, [doneStep, doneStep]);
    const started = Date.now();
    await session.turn("first");
    assert.equal(timers.now(), 0, "no simulated time passed before the first model call");
    assert.ok(Date.now() - started < 5000);
    assert.equal(late.seen.length, 1, "the slow server's probe is still held");
    assert.deepEqual(names(requestTools(session.adapter)[0]), ["mcp__quick__now"]);
    // Thirty seconds later the slow server answers; it joins at the next turn, deferred, and the request is unchanged.
    await timers.advance(30_000);
    slow.open();
    assert.ok(await eventually(() => manager.statuses()[1]?.status === "connecting" && late.seen.length >= 3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await session.turn("second");
    assert.equal(registry.get("mcp__late__later")?.exposure, "deferred");
    const tools = requestTools(session.adapter);
    assert.deepEqual(tools[1], tools[0]);
  });

  test("a direct server that answers in 2 s is listed in the first request", async () => {
    const timers = manualTimers();
    const held = gate();
    const direct = await legacyHttp({ tools: [rawTool("look")], hold: held.promise });
    const registry = createToolRegistry();
    const manager = createMcpManager({
      registry,
      servers: [remoteServer("direct", direct.url, { exposure: "direct" })],
      timers,
    });
    closers.push(() => manager.close());
    const session = await mcpSession(registry, manager, [doneStep]);
    const turn = session.turn("first");
    assert.ok(await eventually(() => direct.seen.length === 1));
    await timers.advance(2000);
    assert.equal(session.adapter.calls.length, 0, "the first model call waits for the direct server");
    held.open();
    await turn;
    assert.deepEqual(names(requestTools(session.adapter)[0]), ["mcp__direct__look"]);
    assert.equal(timers.now(), 2000);
  });

  test("a direct server that misses the 10 s wait is left out, then joins deferred, and the tools sent never change", async () => {
    const timers = manualTimers();
    const held = gate();
    const direct = await legacyHttp({ tools: [rawTool("look")], hold: held.promise });
    const quick = await legacyHttp({ tools: [rawTool("now")] });
    const registry = createToolRegistry();
    const lines: string[] = [];
    const manager = createMcpManager({
      registry,
      servers: [
        remoteServer("quick", quick.url, { exposure: "direct" }),
        remoteServer("direct", direct.url, { exposure: "direct" }),
      ],
      timers,
      log: (line) => lines.push(line),
    });
    closers.push(() => manager.close());
    const session = await mcpSession(registry, manager, [doneStep, doneStep]);
    const turn = session.turn("first");
    assert.ok(await eventually(() => direct.seen.length === 1 && quick.seen.length >= 3));
    await timers.advance(9999);
    assert.equal(session.adapter.calls.length, 0);
    await timers.advance(1);
    await turn;
    assert.deepEqual(names(requestTools(session.adapter)[0]), ["mcp__quick__now"]);
    held.open();
    assert.ok(await eventually(() => direct.seen.some((request) => request.rpc === "tools/list")));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await session.turn("second");
    assert.equal(registry.get("mcp__direct__look")?.exposure, "deferred");
    assert.ok(lines.some((line) => line.includes("connected after the first turn, so its tools are deferred")));
    const tools = requestTools(session.adapter);
    assert.deepEqual(tools[1], tools[0]);
  });
});

describe("failures in the background", () => {
  test("a server that fails is tried once, reported once, and never holds a turn", async () => {
    const server = await startHttp((_request, response) => {
      response.writeHead(500).end("down");
    });
    const registry = createToolRegistry();
    const lines: string[] = [];
    const manager = createMcpManager({
      registry,
      servers: [remoteServer("down", server.url, { exposure: "direct" })],
      log: (line) => lines.push(line),
    });
    closers.push(() => manager.close());
    const session = await mcpSession(registry, manager, [doneStep, doneStep]);
    await session.turn("one");
    const tries = server.seen.length;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await session.turn("two");
    assert.equal(server.seen.length, tries);
    assert.equal(manager.statuses()[0]?.status, "failed");
    assert.equal(lines.filter((line) => line.includes("was not connected")).length, 1);
  });

  test("closing the manager leaves no timer behind", async () => {
    const timers = manualTimers();
    const held = gate();
    const direct = await legacyHttp({ tools: [rawTool("look")], hold: held.promise });
    const manager = createMcpManager({
      registry: createToolRegistry(),
      servers: [remoteServer("direct", direct.url, { exposure: "direct" })],
      timers,
    });
    const turn = manager.beginTurn();
    assert.ok(await eventually(() => direct.seen.length === 1));
    assert.equal(timers.pending(), 1, "the first turn's wait");
    await manager.close();
    assert.deepEqual(await turn, []);
    held.open();
    assert.equal(timers.pending(), 0);
  });
});

describe("the 2026-07-28 change stream", () => {
  let description = "v1";
  const build = () => {
    const server = new McpServer({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.registerTool("look", { description, inputSchema: schema({ type: "object" }) }, (async () => ({
      content: [{ type: "text", text: "looked" }],
    })) as never);
    return server;
  };
  const listens = (seen: readonly { rpc?: string }[]) =>
    seen.filter((request) => request.rpc === "subscriptions/listen");

  test("a change on the listen stream is read, and a dropped stream is opened again", async () => {
    description = "v1";
    const server = await libraryHttp(build);
    const manager = createMcpManager({
      registry: createToolRegistry(),
      servers: [remoteServer("modern", server.url)],
      relistIntervalMs: 0,
    });
    closers.push(() => manager.close());
    await manager.connect();
    assert.ok(await eventually(() => listens(server.seen).length === 1));
    description = "v2";
    server.handler.notify.toolsChanged();
    assert.ok(await eventually(() => manager.pending().length === 1));
    const first = manager.pending()[0]?.hash;
    server.dropStreams();
    assert.ok(await eventually(() => listens(server.seen).length === 2, 10_000), "the listen is issued again");
    description = "v3";
    server.handler.notify.toolsChanged();
    assert.ok(await eventually(() => manager.pending()[0]?.hash !== first, 5000));
  }, 20_000);

  test("a stream that keeps dropping is opened again with growing waits, and then no more", async () => {
    description = "v1";
    const timers = manualTimers();
    const server = await libraryHttp(build);
    const lines: string[] = [];
    const manager = createMcpManager({
      registry: createToolRegistry(),
      servers: [remoteServer("modern", server.url)],
      timers,
      log: (line) => lines.push(line),
    });
    closers.push(() => manager.close());
    await manager.connect();
    const closes = () => lines.filter((line) => line.includes("the change stream of")).length;
    for (let opened = 1; opened <= 12; opened += 1) {
      if (!(await eventually(() => listens(server.seen).length === opened, 1500))) break;
      server.dropStreams();
      // The library may first try to resume the stream with a GET, which a 2026-07-28 server refuses; the drop is
      // logged once the stream is over, and only then is its reopen timer set.
      for (let step = 0; step < 4 && closes() < opened; step += 1) {
        await eventually(() => closes() >= opened, 300);
        await timers.advance(70_000);
      }
      await timers.advance(70_000);
    }
    assert.equal(listens(server.seen).length, 9);
    const waits = lines.flatMap((line) => /opened again in (\d+) ms/.exec(line)?.[1] ?? []).map(Number);
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
    assert.ok(lines.some((line) => line.includes("ended 8 times in a row, so it is not opened again")));
  }, 30_000);
});
