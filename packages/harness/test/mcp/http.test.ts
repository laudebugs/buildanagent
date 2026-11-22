// MCP over streamable HTTP and legacy SSE, against servers on 127.0.0.1 in this process: a real 2026-07-28 server on
// @modelcontextprotocol/server 2.4.0 and scripted legacy ones. Each hostile server misbehaves at the HTTP layer, and
// each test shows what the harness does instead of what the server asked for.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { isHarnessError } from "@buildanagent/harness";
import { connectMcpServer, createMcpManager, McpError, type McpServerConfig } from "@buildanagent/harness/mcp";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, test } from "vitest";
import { eventually } from "./helpers.js";
import { libraryHttp, manualTimers, remoteServer, startHttp } from "./http-helpers.js";
import { legacyHttp, legacySse, rawTool } from "./raw-http.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const signal = () => new AbortController().signal;
const OBJECT = {
  "~standard": {
    version: 1,
    vendor: "buildanagent-test",
    validate: (value: unknown) => ({ value }),
    jsonSchema: { input: () => ({ type: "object" }), output: () => ({ type: "object" }) },
  },
} as never;

/** A real server with one `echo` tool. */
function echoServer(): McpServer {
  const server = new McpServer({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.registerTool("echo", { description: "Returns its text.", inputSchema: OBJECT }, (async (input: {
    text?: string;
  }) => ({ content: [{ type: "text", text: String(input?.text) }] })) as never);
  return server;
}

async function connected(config: McpServerConfig, log?: (line: string) => void) {
  const connection = await connectMcpServer(config, log === undefined ? {} : { log });
  closers.push(() => connection.close());
  return connection;
}

async function refusedConnect(config: McpServerConfig): Promise<McpError> {
  const error = await connectMcpServer(config).then(
    (connection) => {
      closers.push(() => connection.close());
      throw new Error("the connect was expected to fail");
    },
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof McpError, String(error));
  assert.equal(error.code, "mcp_connect_failed");
  return error;
}

describe("the transports", () => {
  test("a 2026-07-28 server over HTTP connects in its era with no initialize, and a call reaches it", async () => {
    const server = await libraryHttp(echoServer);
    const connection = await connected(remoteServer("modern", server.url));
    assert.equal(connection.era, "2026-07-28");
    assert.deepEqual(
      (await connection.listTools()).map((tool) => tool.name),
      ["echo"],
    );
    const result = await connection.callTool("echo", { text: "over http" }, signal());
    assert.deepEqual(result.content, [{ type: "text", text: "over http" }]);
    assert.ok(!server.seen.some((request) => request.rpc === "initialize"));
    assert.equal(server.seen[0]?.rpc, "server/discover");
  });

  test("a legacy streamable HTTP server connects as legacy, and its session id comes back on every later request", async () => {
    const server = await legacyHttp({ tools: [rawTool("a")] });
    const connection = await connected(remoteServer("legacy", server.url));
    assert.equal(connection.era, "legacy");
    await connection.listTools();
    const after = server.seen.slice(server.seen.findIndex((request) => request.rpc === "initialize") + 1);
    assert.ok(after.length >= 2);
    for (const request of after) assert.equal(request.headers["mcp-session-id"], "session-1");
  });

  test("a legacy SSE server connects with no probe, answers on its stream, and its stream's end closes the connection", async () => {
    const calls: { name: string; arguments: unknown }[] = [];
    const server = await legacySse({ tools: [rawTool("a")], calls });
    const lines: string[] = [];
    const connection = await connected(remoteServer("sse", server.url, { transport: { kind: "sse" } }), (line) =>
      lines.push(line),
    );
    assert.equal(connection.era, "legacy");
    assert.equal(server.seen.find((request) => request.method === "POST")?.rpc, "initialize");
    assert.deepEqual((await connection.callTool("a", { text: "x" }, signal())).content, [
      { type: "text", text: "called a" },
    ]);
    assert.deepEqual(calls, [{ name: "a", arguments: { text: "x" } }]);
    server.endStream();
    // The event stream would reconnect after its own delay; the harness refuses the second GET and closes instead.
    assert.ok(await eventually(() => connection.closed, 10_000));
    assert.equal(server.seen.filter((request) => request.method === "GET").length, 1);
    assert.ok(lines.some((line) => line.includes("nothing reconnects it")));
  }, 15_000);

  test("an SSE endpoint on another origin is refused, and nothing is posted there", async () => {
    const elsewhere = await startHttp((_request, response) => {
      response.writeHead(202).end();
    });
    const server = await legacySse({ tools: [], endpoint: `${elsewhere.url}?session=1` });
    await refusedConnect(remoteServer("sse", server.url, { transport: { kind: "sse" }, connectTimeoutMs: 3000 }));
    assert.equal(elsewhere.seen.length, 0);
  });
});

describe("hostile HTTP answers", () => {
  test("a redirect is not followed, to any origin, and the target hears nothing", async () => {
    const target = await libraryHttp(echoServer);
    for (const status of [301, 302, 307, 308]) {
      const server = await startHttp((_request, response) => {
        response.writeHead(status, { location: target.url }).end();
      });
      const error = await refusedConnect(remoteServer("redirect", server.url));
      assert.match(error.message, /redirect/);
    }
    assert.equal(target.seen.length, 0);
    // The client library itself would follow a redirect within the origin; the harness follows none.
    const same = await startHttp((request, response) => {
      if (request.url === "/mcp") response.writeHead(307, { location: "/real" }).end();
      else response.writeHead(500).end();
    });
    await refusedConnect(remoteServer("same", same.url));
    assert.deepEqual(
      same.seen.map((request) => request.url),
      ["/mcp"],
    );
  });

  test("a status line outside 200 to 599 fails the request, and never throws out of the response handler", async () => {
    for (const status of [600, 999]) {
      const raw = createServer((socket) => {
        socket.once("data", () =>
          socket.end(`HTTP/1.1 ${status} Nope\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`),
        );
      });
      await new Promise<void>((resolve) => raw.listen(0, "127.0.0.1", resolve));
      closers.push(() => new Promise<void>((resolve) => raw.close(() => resolve())));
      const port = (raw.address() as { port: number }).port;
      const error = await refusedConnect(
        remoteServer("odd", `http://127.0.0.1:${port}/mcp`, { connectTimeoutMs: 3000 }),
      );
      assert.match(error.message, new RegExp(`status ${status}`));
    }
  });

  test("a 304 is refused for what it is, not as a redirect", async () => {
    const server = await startHttp((_request, response) => {
      response.writeHead(304).end();
    });
    const error = await refusedConnect(remoteServer("cached", server.url));
    assert.match(error.message, /304 Not Modified/);
    assert.doesNotMatch(error.message, /redirect/);
  });

  test("a 401 fails the connect with a clear error and starts no authorization flow", async () => {
    const server = await startHttp((_request, response) => {
      response.writeHead(401, { "www-authenticate": 'Bearer resource_metadata="https://evil.test/.well-known"' }).end();
    });
    const error = await refusedConnect(remoteServer("auth", server.url));
    assert.match(error.message, /authorization \(HTTP 401\); this harness runs no authorization flow/);
    assert.equal(server.seen.length, 1);
  });

  test("a session id that is not visible ASCII, or is too long, fails the connect", async () => {
    for (const id of ["has space", "x".repeat(257)]) {
      const server = await legacyHttp({
        tools: [],
        hook: (_request, response, seen) => {
          if (seen.rpc !== "initialize") return false;
          const body = { jsonrpc: "2.0", id: JSON.parse(seen.body).id, result: {} };
          response
            .writeHead(200, { "content-type": "application/json", "mcp-session-id": id })
            .end(JSON.stringify(body));
          return true;
        },
      });
      const error = await refusedConnect(remoteServer("session", server.url));
      assert.match(error.message, /session id/);
    }
  });

  test("a JSON body over maxMessageBytes fails, and so does an event or a line past it", async () => {
    const big = (kind: string) =>
      startHttp((_request, response) => {
        if (kind === "json") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(`{"pad":"${"x".repeat(20_000)}"}`);
        } else if (kind === "event") {
          response.writeHead(200, { "content-type": "text/event-stream" });
          for (let index = 0; index < 50; index += 1) response.write(`data: ${"y".repeat(500)}\n`);
        } else {
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.write(`data: ${"z".repeat(20_000)}`);
        }
      });
    for (const kind of ["json", "event", "line"]) {
      const server = await big(kind);
      const error = await refusedConnect(
        remoteServer("big", server.url, { transport: { maxMessageBytes: 10_000 }, connectTimeoutMs: 5000 }),
      );
      assert.match(error.message, /bytes/, kind);
    }
  });

  test("a stream past maxStreamBytes in all is cut", async () => {
    const server = await startHttp((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (let index = 0; index < 200; index += 1) response.write(`: ${"k".repeat(500)}\n`);
    });
    const error = await refusedConnect(
      remoteServer("long", server.url, { transport: { maxStreamBytes: 20_000 }, connectTimeoutMs: 5000 }),
    );
    assert.match(error.message, /passed 20000 bytes/);
  });

  test("a server that never sends its headers is cut at headersTimeoutMs", async () => {
    const server = await startHttp(() => {});
    const started = Date.now();
    const error = await refusedConnect(
      remoteServer("slow", server.url, { transport: { headersTimeoutMs: 300 }, connectTimeoutMs: 20_000 }),
    );
    assert.match(error.message, /no response began within 300 ms/);
    assert.ok(Date.now() - started < 5000);
  });

  test("a stream that goes quiet is cut at streamIdleMs, and one that drips forever at maxStreamMs", async () => {
    const quiet = await startHttp((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": hello\n\n");
    });
    const idle = await refusedConnect(
      remoteServer("quiet", quiet.url, { transport: { streamIdleMs: 300 }, connectTimeoutMs: 20_000 }),
    );
    assert.match(idle.message, /sent nothing for 300 ms/);
    const dripping = await startHttp((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const timer = setInterval(() => response.write(": drip\n\n"), 50);
      response.once("close", () => clearInterval(timer));
    });
    const endless = await refusedConnect(
      remoteServer("drip", dripping.url, { transport: { maxStreamMs: 500 }, connectTimeoutMs: 20_000 }),
    );
    assert.match(endless.message, /stayed open past 500 ms/);
  });

  test("a compressed answer the harness did not ask for is refused, so no bomb is ever decoded", async () => {
    const server = await startHttp((request, response) => {
      assert.equal(request.headers["accept-encoding"], "identity");
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      response.end(Buffer.alloc(64));
    });
    const error = await refusedConnect(remoteServer("gzip", server.url));
    assert.match(error.message, /compressed/);
  });

  test("a malformed event is dropped and the next one is read: a BOM, a NUL, CR line ends and a huge id", async () => {
    const server = await startHttp((_request, response, seen) => {
      const id = JSON.parse(seen.body).id;
      const reply = { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
      if (seen.rpc !== "server/discover") {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify(
            seen.rpc === "initialize"
              ? {
                  jsonrpc: "2.0",
                  id,
                  result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "x", version: "1" } },
                }
              : { jsonrpc: "2.0", id, result: {} },
          ),
        );
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("﻿");
      response.write(`id: ${"i".repeat(5000)}\r`);
      response.write("data: {\u0000}\r\r");
      // The parser holds a CR at the very end of a stream to see whether an LF follows, so a comment closes it.
      response.write(`data: ${JSON.stringify(reply)}\r\r: end\n`);
      response.end();
    });
    const connection = await connected(remoteServer("odd", server.url));
    assert.equal(connection.era, "legacy");
  });

  test("a server's request to the client, such as sampling, is refused and never answered with model output", async () => {
    const answers: unknown[] = [];
    const server = await legacyHttp({
      tools: [],
      hook: (request, response, seen) => {
        if (request.method === "POST" && seen.rpc === undefined && seen.body.includes('"error"')) {
          answers.push(JSON.parse(seen.body));
          response.writeHead(202).end();
          return true;
        }
        if (request.method !== "GET") return false;
        response.writeHead(200, { "content-type": "text/event-stream" });
        const ask = {
          jsonrpc: "2.0",
          id: 99,
          method: "sampling/createMessage",
          params: { messages: [], maxTokens: 9 },
        };
        response.write(`event: message\ndata: ${JSON.stringify(ask)}\n\n`);
        return true;
      },
    });
    await connected(remoteServer("asker", server.url));
    assert.ok(await eventually(() => answers.length > 0, 5000));
    assert.equal((answers[0] as { error?: { code?: number } }).error?.code, -32601);
  });

  test("no more than maxStreams responses are open at once, and the rest fail at once", async () => {
    const held: (() => void)[] = [];
    const server = await legacyHttp({
      tools: [rawTool("slow")],
      hook: (_request, response, seen) => {
        if (seen.rpc !== "tools/call") return false;
        held.push(() => {
          const body = { jsonrpc: "2.0", id: JSON.parse(seen.body).id, result: { content: [] } };
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
        });
        return true;
      },
    });
    const connection = await connected(remoteServer("busy", server.url, { transport: { maxStreams: 3 } }));
    // The GET stream holds one of the three.
    assert.ok(await eventually(() => server.streams() === 1));
    const calls = Array.from({ length: 4 }, () =>
      connection.callTool("slow", {}, signal()).then(
        () => "done",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    );
    assert.ok(await eventually(() => held.length === 2));
    const early = await Promise.race([
      Promise.all(calls.slice(2)),
      new Promise((resolve) => setTimeout(resolve, 2000, "hung")),
    ]);
    assert.ok(Array.isArray(early), "the calls past the limit should fail at once");
    for (const message of early as string[]) assert.match(message, /already open/);
    for (const release of held) release();
    assert.deepEqual(await Promise.all(calls.slice(0, 2)), ["done", "done"]);
  });

  test("a dropped GET stream is reopened on the harness's schedule, not the server's retry, and closes past its budget", async () => {
    let gets = 0;
    const server = await legacyHttp({
      tools: [],
      hook: (request, response) => {
        if (request.method !== "GET") return false;
        gets += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end("retry: 0\nid: 1\n: bye\n\n");
        return true;
      },
    });
    const lines: string[] = [];
    const connection = await connected(remoteServer("flappy", server.url), (line) => lines.push(line));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    // With the server's `retry: 0` obeyed the stream would reopen hundreds of times; the harness waits a second, then two.
    assert.ok(gets >= 1 && gets <= 3, `${gets} GETs in 2.5 s`);
    assert.ok(!connection.closed);
  }, 10_000);

  test("a GET stream that drops ten times in ten minutes closes the connection, and is opened no more", async () => {
    let gets = 0;
    const server = await legacyHttp({
      tools: [],
      hook: (request, response) => {
        if (request.method !== "GET") return false;
        gets += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end("id: 1\n: bye\n\n");
        return true;
      },
    });
    const timers = manualTimers();
    const lines: string[] = [];
    const connection = await connectMcpServer(remoteServer("flappy", server.url), {
      timers,
      log: (line) => lines.push(line),
    });
    closers.push(() => connection.close());
    for (let round = 0; round < 15 && !connection.closed; round += 1) {
      await eventually(() => timers.pending() > 0 || connection.closed, 1000);
      await timers.advance(30_000);
    }
    assert.ok(connection.closed);
    assert.equal(gets, 11, "the first stream and ten reopens");
    assert.ok(lines.some((line) => line.includes("dropped 10 times in ten minutes")));
  }, 20_000);
});

describe("credentials and records", () => {
  test("configured headers reach the server, and no log line, error or record holds a header value or the URL", async () => {
    const secret = "Bearer sk-live-0123456789abcdef";
    const server = await startHttp((request, response, seen) => {
      // A hostile server echoes what it was sent back into its error, where the client library puts it in its message.
      const echo = `you sent ${request.headers.authorization} to ${request.url}`;
      const id = JSON.parse(seen.body || "{}").id;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: echo } }));
    });
    const lines: string[] = [];
    const url = `${server.url}?tenant=acme-secret-tenant-id`;
    const config = remoteServer("echoer", url, { transport: { headers: { Authorization: secret } } });
    const error = await connectMcpServer(config, { log: (line) => lines.push(line) }).then(
      () => undefined,
      (failure: unknown) => failure as Error,
    );
    assert.ok(error instanceof McpError);
    assert.equal(server.seen[0]?.headers.authorization, secret);
    for (const text of [error.message, ...lines]) {
      assert.ok(!text.includes("sk-live"), text);
      assert.ok(!text.includes("acme-secret-tenant-id"), text);
    }
  });

  test("the record of an HTTP server holds its transport, a URL hash and no URL or header", async () => {
    const server = await libraryHttp(echoServer);
    const recordOf = async (url: string, headers?: Record<string, string>) => {
      const manager = createMcpManager({
        registry: createToolRegistry(),
        servers: [remoteServer("rec", url, headers === undefined ? {} : { transport: { headers } })],
      });
      closers.push(() => manager.close());
      const [status] = await manager.connect();
      assert.equal(status?.status, "connected", status?.status === "failed" ? status.error.message : "");
      return manager.records()[0];
    };
    const plain = await recordOf(server.url, { "X-Api": "header-canary-value" });
    assert.equal(plain?.mcp?.transport, "http");
    assert.match(plain?.mcp?.urlHash ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.equal(plain?.mcp?.commandHash, undefined);
    const text = JSON.stringify(plain);
    assert.ok(!text.includes("127.0.0.1") && !text.includes("header-canary-value"), text);
    // Two spellings of one endpoint hash alike, and another endpoint hashes apart.
    const spelled = await recordOf(server.url.replace("http://127.0.0.1", "HTTP://127.0.0.1"));
    assert.equal(spelled?.mcp?.urlHash, plain?.mcp?.urlHash);
    const other = await recordOf(`${server.url}?v=2`);
    assert.notEqual(other?.mcp?.urlHash, plain?.mcp?.urlHash);
  });

  test("a request through an egress proxy goes through its fetch, and the guard still refuses a redirect there", async () => {
    const seen: string[] = [];
    const redirecting = {
      async fetch(input: string | URL): Promise<Response> {
        seen.push(String(input));
        return new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } });
      },
    };
    const config: McpServerConfig = {
      name: "proxied",
      transport: { kind: "http", url: "https://mcp.example.test/mcp", proxy: redirecting },
    };
    const error = await refusedConnect(config);
    assert.match(error.message, /redirect/);
    assert.deepEqual(seen, ["https://mcp.example.test/mcp"]);
  });

  test("a proxy URL that is not https is refused when the manager is made", () => {
    assert.throws(
      () =>
        createMcpManager({
          registry: createToolRegistry(),
          servers: [
            {
              name: "proxied",
              transport: {
                kind: "http",
                url: "http://127.0.0.1:1/mcp",
                unsafeAllowLoopback: true,
                proxy: { fetch: () => Promise.reject(new Error("unused")) },
              },
            },
          ],
        }),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_mcp_config",
    );
  });
});

describe("closing", () => {
  test("closing the manager ends a connect still waiting on a server, and its socket", async () => {
    let closedSocket = false;
    const server = await startHttp((request) => {
      request.socket.once("close", () => {
        closedSocket = true;
      });
    });
    const manager = createMcpManager({ registry: createToolRegistry(), servers: [remoteServer("hung", server.url)] });
    manager.start();
    assert.ok(await eventually(() => server.seen.length === 1));
    const started = Date.now();
    await manager.close();
    assert.ok(Date.now() - started < 3000);
    assert.ok(await eventually(() => closedSocket));
    assert.equal(manager.statuses()[0]?.status, "failed");
  });
});
