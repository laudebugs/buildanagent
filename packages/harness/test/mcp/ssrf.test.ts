// Where a remote server's requests may go. The URL comes from host config, but a name's answer can point at the
// host's own network, so every address a name resolves to, and the address a socket reaches, is checked. A test reaches
// a server on 127.0.0.1 only through `unsafeAllowLoopback`, and names resolve through a table, so no test needs DNS.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessError } from "@buildanagent/harness";
import { type EgressRecord, startEgressProxy } from "@buildanagent/harness/credentials";
import { connectMcpServer, createMcpManager, McpError, type McpServerConfig } from "@buildanagent/harness/mcp";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { afterAll, beforeAll, describe, test, vi } from "vitest";
import { platformFetch } from "../../src/mcp/remote.js";
import { checkRemoteTransport } from "../../src/mcp/remote-config.js";
import { eventually } from "./helpers.js";
import { legacyHttp, rawTool } from "./raw-http.js";

const refusedConfig = (transport: Record<string, unknown>) =>
  assert.throws(
    () =>
      createMcpManager({
        registry: createToolRegistry(),
        servers: [{ name: "bad", transport: { kind: "http", ...transport } as never }],
      }),
    (error: unknown) => isHarnessError(error) && error.code === "invalid_mcp_config",
    JSON.stringify(transport),
  );

async function connectError(config: McpServerConfig): Promise<McpError> {
  const error = await connectMcpServer(config).then(
    async (connection) => {
      await connection.close();
      throw new Error("the connect was expected to fail");
    },
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof McpError, String(error));
  return error;
}

describe("the config", () => {
  test("refuses a URL that is not https, holds a credential or can't be one", () => {
    refusedConfig({ url: "http://mcp.example.com/mcp" });
    refusedConfig({ url: "ftp://mcp.example.com/mcp" });
    refusedConfig({ url: "https://user:pass@mcp.example.com/mcp" });
    refusedConfig({ url: "https://mcp.example.com/mcp#part" });
    refusedConfig({ url: "https://mcp.example.com/mcp?token=abc" });
    refusedConfig({ url: "https://mcp.example.com/mcp?x_api_key=abc" });
    refusedConfig({ url: "https://mcp.example.com/mcp\r\nHost: evil" });
    refusedConfig({ url: "https://mcp.example.com/mc\tp" });
    refusedConfig({ url: "not a url" });
    refusedConfig({ url: `https://mcp.example.com/${"a".repeat(3000)}` });
  });

  test("refuses a header the transport sets, a value with a line break, and a bad name", () => {
    for (const name of ["Host", "content-length", "Mcp-Session-Id", "MCP-Protocol-Version", "Accept-Encoding"]) {
      refusedConfig({ url: "https://mcp.example.com/mcp", headers: { [name]: "x" } });
    }
    refusedConfig({ url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer a\r\nX-Evil: 1" } });
    refusedConfig({ url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer a\u0000" } });
    refusedConfig({ url: "https://mcp.example.com/mcp", headers: { "Bad Name": "x" } });
    refusedConfig({ url: "https://mcp.example.com/mcp", headers: { a: "1", A: "2" } });
  });

  test("never quotes a refused header value or URL back, since either may be a secret", () => {
    try {
      createMcpManager({
        registry: createToolRegistry(),
        servers: [
          {
            name: "bad",
            transport: { kind: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "sk-live\nzz" } },
          },
        ],
      });
      assert.fail("expected a refusal");
    } catch (error) {
      assert.ok(!(error as Error).message.includes("sk-live"));
    }
    try {
      createMcpManager({
        registry: createToolRegistry(),
        servers: [{ name: "bad", transport: { kind: "http", url: "https://u:hunter2@mcp.example.com/" } }],
      });
      assert.fail("expected a refusal");
    } catch (error) {
      assert.ok(!(error as Error).message.includes("hunter2"));
    }
  });

  test("an address range must parse, and allowing one never allows loopback", () => {
    refusedConfig({ url: "https://mcp.example.com/mcp", allowAddresses: ["10.0.0.0/33"] });
    refusedConfig({ url: "https://mcp.example.com/mcp", allowAddresses: ["not-an-address"] });
    const { allows } = checkRemoteTransport({
      kind: "http",
      url: "https://mcp.example.com/mcp",
      allowAddresses: ["10.20.0.0/16", "fd00:1::/32", "127.0.0.0/8"],
    });
    assert.equal(allows("10.20.3.4"), true);
    assert.equal(allows("::ffff:10.20.3.4"), true);
    assert.equal(allows("10.21.0.1"), false);
    assert.equal(allows("fd00:1:2::3"), true);
    assert.equal(allows("fd00:2::3"), false);
    assert.equal(allows("127.0.0.1"), false);
    assert.equal(allows("8.8.8.8"), true);
  });

  test("a range that admits far more than it seems is refused", () => {
    for (const range of [
      "::ffff:10.0.0.0/8",
      "::/8",
      "0.0.0.0/0",
      "::/0",
      // A mapped prefix of 96 bits or wider is all of IPv4, and so is every other IPv6 form that wraps IPv4.
      "::ffff:0:0/96",
      "::ffff:0.0.0.0/96",
      "::/96",
      "64:ff9b::/96",
      "2002::/16",
      // Brackets belong in a URL, not in a range; read as written they turned an IPv4 range into an IPv6 one.
      "[10.0.0.0]/8",
      "[fd00::]/8",
      "[10.1.2.3]",
    ]) {
      refusedConfig({ url: "https://mcp.example.com/mcp", allowAddresses: [range] });
    }
    for (const range of ["::ffff:10.0.0.0/104", "fd00::/8", "10.0.0.0/8", "10.1.2.3"]) {
      checkRemoteTransport({ kind: "http", url: "https://mcp.example.com/mcp", allowAddresses: [range] });
    }
    const { allows } = checkRemoteTransport({
      kind: "http",
      url: "https://mcp.example.com/mcp",
      allowAddresses: ["::ffff:10.0.0.0/104"],
    });
    assert.equal(allows("10.1.2.3"), true);
    assert.equal(allows("172.16.0.1"), false);
  });

  test("by default refuses every address that is not public, in every IPv4 and IPv6 form", () => {
    const { allows } = checkRemoteTransport({ kind: "http", url: "https://mcp.example.com/mcp" });
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:10.0.0.1",
      "64:ff9b::a9fe:a9fe",
      "2002:a9fe:a9fe::",
      "not-an-address",
    ]) {
      assert.equal(allows(address), false, address);
    }
    assert.equal(allows("93.184.216.34"), true);
    assert.equal(allows("2606:4700::1111"), true);
  });

  test("plain http reaches loopback only, and only with unsafeAllowLoopback", () => {
    const { allows } = checkRemoteTransport({
      kind: "http",
      url: "http://mcp.test:8080/mcp",
      unsafeAllowLoopback: true,
    });
    assert.equal(allows("127.0.0.1"), true);
    assert.equal(allows("::1"), true);
    assert.equal(allows("93.184.216.34"), false);
    refusedConfig({ url: "http://127.0.0.1:8080/mcp" });
  });
});

describe("the addresses a request reaches", () => {
  test("a loopback literal is refused without unsafeAllowLoopback, and no connection is made", async () => {
    const server = await legacyHttp({ tools: [] });
    const url = server.url.replace("http:", "https:");
    const error = await connectError({ name: "loop", transport: { kind: "http", url }, connectTimeoutMs: 3000 });
    assert.match(error.message, /may not reach/);
    assert.equal(server.connections(), 0);
  });

  test("a name that resolves to a refused address is refused before any connection", async () => {
    const server = await legacyHttp({ tools: [] });
    for (const answer of [["10.0.0.7"], ["169.254.169.254"], ["::ffff:127.0.0.1"], ["fd00::1"], ["127.0.0.1"]]) {
      const error = await connectError({
        name: "named",
        transport: {
          kind: "http",
          url: `https://mcp.test:${server.port}/mcp`,
          resolve: async () => answer,
        },
        connectTimeoutMs: 3000,
      });
      assert.match(error.message, /resolves to an address it may not reach/, answer.join());
    }
    assert.equal(server.connections(), 0);
  });

  test("one refused address among a name's answers refuses the name", async () => {
    const server = await legacyHttp({ tools: [] });
    const error = await connectError({
      name: "mixed",
      transport: {
        kind: "http",
        url: `http://mcp.test:${server.port}/mcp`,
        unsafeAllowLoopback: true,
        resolve: async () => ["127.0.0.1", "10.1.2.3"],
      },
      connectTimeoutMs: 3000,
    });
    assert.match(error.message, /may not reach/);
    assert.equal(server.connections(), 0);
  });

  test("a name is resolved once per request and the request connects to that answer, with the name as its Host", async () => {
    const server = await legacyHttp({ tools: [rawTool("a")] });
    const lookups: string[] = [];
    const connection = await connectMcpServer({
      name: "pinned",
      transport: {
        kind: "http",
        url: `http://mcp.test:${server.port}/mcp`,
        unsafeAllowLoopback: true,
        resolve: async (host) => {
          lookups.push(host);
          return ["127.0.0.1"];
        },
      },
    });
    try {
      await connection.listTools();
      const posts = server.seen.filter((request) => request.method === "POST").length;
      assert.ok(lookups.length >= posts, `${lookups.length} lookups for ${posts} posts`);
      assert.ok(lookups.every((host) => host === "mcp.test"));
      assert.ok(server.seen.every((request) => request.headers.host === `mcp.test:${server.port}`));
    } finally {
      await connection.close();
    }
  });

  test("a name whose answer changes to a refused address is refused at that request, whatever it said before", async () => {
    const server = await legacyHttp({ tools: [rawTool("a")] });
    let rebound = false;
    const connection = await connectMcpServer({
      name: "rebind",
      transport: {
        kind: "http",
        url: `http://mcp.test:${server.port}/mcp`,
        unsafeAllowLoopback: true,
        resolve: async () => (rebound ? ["10.0.0.1"] : ["127.0.0.1"]),
      },
    });
    try {
      rebound = true;
      const before = server.seen.length;
      await assert.rejects(connection.listTools(), /may not reach|could not be read/);
      assert.equal(server.seen.length, before);
    } finally {
      await connection.close();
    }
  });
});

describe("a runtime without Node's network", () => {
  test("the platform fetch reaches a localhost name over http only with unsafeAllowLoopback, and no other name", async () => {
    const reached: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      reached.push(String(input));
      return new Response("{}");
    });
    try {
      const loopback = (url: string) =>
        platformFetch(checkRemoteTransport({ kind: "http", url, unsafeAllowLoopback: true }));
      await loopback("http://localhost:8080/mcp")("http://localhost:8080/mcp");
      await loopback("http://mcp.localhost:8080/mcp")("http://mcp.localhost:8080/mcp");
      await loopback("http://127.0.0.1:8080/mcp")("http://127.0.0.1:8080/mcp");
      await assert.rejects(loopback("http://mcp.example.test/mcp")("http://mcp.example.test/mcp"), /loopback/);
      // A trailing dot names the same host.
      await assert.rejects(
        platformFetch(checkRemoteTransport({ kind: "http", url: "https://localhost./mcp" }))("https://localhost./mcp"),
        /may not reach/,
      );
      await assert.rejects(
        platformFetch(checkRemoteTransport({ kind: "http", url: "https://LOCALHOST./mcp" }))("https://LOCALHOST./mcp"),
        /may not reach/,
      );
      const strict = platformFetch(checkRemoteTransport({ kind: "http", url: "https://localhost/mcp" }));
      await assert.rejects(strict("https://localhost/mcp"), /may not reach/);
      assert.deepEqual(reached, [
        "http://localhost:8080/mcp",
        "http://mcp.localhost:8080/mcp",
        "http://127.0.0.1:8080/mcp",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("TLS", () => {
  let folder = "";
  let certificate = "";
  let server: https.Server;
  let port = 0;
  let plain = 0;

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "harness-mcp-tls-"));
    execFileSync(
      "openssl",
      [
        ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"],
        ...["-keyout", join(folder, "key.pem"), "-out", join(folder, "cert.pem")],
        ...["-subj", "/CN=mcp.test", "-addext", "subjectAltName=DNS:mcp.test"],
      ],
      { stdio: "ignore" },
    );
    certificate = readFileSync(join(folder, "cert.pem"), "utf8");
    const key = readFileSync(join(folder, "key.pem"), "utf8");
    server = https.createServer({ key, cert: certificate }, (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const message = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { id?: number; method?: string };
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const result =
          message.method === "initialize"
            ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "tls", version: "1" } }
            : { tools: [] };
        const body =
          message.method === "server/discover"
            ? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }
            : { jsonrpc: "2.0", id: message.id, result };
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    // A plain server for the downgrade check, which a TLS client must never fall back to.
    const http = await import("node:http");
    const insecure = http.createServer((_request, response) => response.end("{}"));
    await new Promise<void>((resolve) => insecure.listen(0, "127.0.0.1", resolve));
    plain = (insecure.address() as AddressInfo).port;
    afterAll(() => new Promise<void>((resolve) => insecure.close(() => resolve())));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  });

  const tls = (extra: Record<string, unknown> = {}, at = port): McpServerConfig => ({
    name: "tls",
    transport: {
      kind: "http",
      url: `https://mcp.test:${at}/mcp`,
      unsafeAllowLoopback: true,
      resolve: async () => ["127.0.0.1"],
      ...extra,
    },
    connectTimeoutMs: 5000,
  });

  test("a certificate nobody trusts fails the connect, and the server's own authority lets it through", async () => {
    const error = await connectError(tls());
    assert.match(error.message, /certificate/i);
    const connection = await connectMcpServer(tls({ ca: certificate }));
    assert.equal(connection.era, "legacy");
    await connection.close();
  });

  test("an https URL never falls back to plain http", async () => {
    const error = await connectError(tls({ ca: certificate }, plain));
    assert.doesNotMatch(error.message, /connected/);
  });

  test("through the egress proxy, a host on its allowlist is reached and logged, and any other is refused", async () => {
    const records: EgressRecord[] = [];
    const proxy = await startEgressProxy({
      allow: [`mcp.test:${port}`],
      log: (record) => records.push(record),
      ca: certificate,
      resolve: async () => ["127.0.0.1"],
      unsafeAllowAddresses: ["127.0.0.1"],
    });
    try {
      const connection = await connectMcpServer({
        name: "proxied",
        transport: { kind: "http", url: `https://mcp.test:${port}/mcp`, proxy },
      });
      assert.equal(connection.era, "legacy");
      await connection.close();
      assert.ok(await eventually(() => records.length >= 3));
      assert.ok(
        records.every((record) => record.kind === "fetch" && record.status < 300 && record.host === "mcp.test"),
      );
      const before = records.length;
      const error = await connectError({
        name: "elsewhere",
        transport: { kind: "http", url: `https://other.test:${port}/mcp`, proxy },
        connectTimeoutMs: 3000,
      });
      assert.match(error.message, /egress proxy refused/);
      assert.equal(records.at(-1)?.reason, "not_allowed");
      assert.equal(records.length, before + 1);
    } finally {
      await proxy.close();
    }
  });
});
