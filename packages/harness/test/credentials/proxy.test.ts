import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { type EgressProxy, type EgressRecord, scrubSecrets, startEgressProxy } from "@buildanagent/harness/credentials";
import type { SessionEntry } from "@buildanagent/protocol";
import { afterAll, beforeAll, test } from "vitest";

// A real HTTPS server on loopback with a self-signed certificate that only this file trusts, standing in for the
// internet. The proxy resolves names through a table, so no test needs DNS.
const SECRET = "ghp_REALSECRET_0123456789abcdefABCDEF";
const folders: string[] = [];
let certificate = "";
let key = "";
let upstream: https.Server;
let upstreamPort = 0;
let seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = [];
let proxy: EgressProxy;
let logs: EgressRecord[] = [];
const resolutions: Record<string, string[]> = {};
let resolveCalls: string[] = [];
let slowClosed = false;

const resolve = async (host: string): Promise<readonly string[]> => {
  resolveCalls.push(host);
  const found = resolutions[host];
  if (found === undefined) throw new Error(`no such host ${host}`);
  return found;
};

beforeAll(async () => {
  const folder = mkdtempSync(join(tmpdir(), "harness-egress-"));
  folders.push(folder);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(folder, "key.pem"),
      "-out",
      join(folder, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=upstream.test",
      "-addext",
      "subjectAltName=DNS:upstream.test",
    ],
    { stdio: "ignore" },
  );
  certificate = readFileSync(join(folder, "cert.pem"), "utf8");
  key = readFileSync(join(folder, "key.pem"), "utf8");
  upstream = https.createServer({ key, cert: certificate }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/nobody") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url === "/slow") {
        const timer = setTimeout(() => response.end("late"), 1500);
        request.on("close", () => {
          clearTimeout(timer);
          slowClosed = true;
        });
        return;
      }
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      response.writeHead(200, { "content-type": "application/json", "x-upstream": "yes" });
      response.end(JSON.stringify({ ok: true, big: "x".repeat(2000) }));
    });
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  upstreamPort = (upstream.address() as net.AddressInfo).port;
  Object.assign(resolutions, {
    "upstream.test": ["127.0.0.1"],
    "metadata.test": ["169.254.169.254"],
    "loopback.test": ["127.0.0.1"],
    "private.test": ["10.0.0.5"],
    "mixed.test": ["93.184.216.34", "10.0.0.5"],
    "v6.test": ["::1"],
    "mapped.test": ["::ffff:127.0.0.1"],
    "rebind.test": ["127.0.0.1"],
  });
  proxy = await startEgressProxy({
    allow: [
      `upstream.test:${upstreamPort}`,
      "*.wild.test",
      "metadata.test",
      "loopback.test",
      "private.test",
      "mixed.test",
      "v6.test",
      "mapped.test",
    ],
    routes: [
      {
        route: "svc",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET", "POST"],
        header: "authorization",
        secret: async () => SECRET,
      },
      {
        route: "readonly",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "x-api-key",
        secret: async () => SECRET,
      },
    ],
    log: (record) => logs.push(record),
    resolve,
    ca: certificate,
    unsafeAllowAddresses: ["127.0.0.1"],
  });
});
afterAll(async () => {
  await proxy?.close();
  await new Promise<void>((done) => (upstream ? upstream.close(() => done()) : done()));
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Asks the proxy for a tunnel to `target` and returns the status line and the open socket. */
function connect(via: EgressProxy, target: string): Promise<{ status: number; socket: net.Socket }> {
  const { port } = new URL(via.url);
  return new Promise((done, fail) => {
    const socket = net.connect(Number(port), "127.0.0.1", () =>
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
    );
    let buffer = "";
    socket.on("data", function onData(chunk) {
      buffer += chunk.toString();
      if (!buffer.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      done({ status: Number(buffer.split(" ")[1]), socket });
    });
    socket.on("error", fail);
  });
}

/** A route request, as a sandboxed tool sends it: to the proxy's own address, with the sentinel where the credential goes. */
function routeRequest(
  via: EgressProxy,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const { port } = new URL(via.url);
  return new Promise((done, fail) => {
    const request = http.request(
      { host: "127.0.0.1", port: Number(port), path, method: init.method ?? "GET", headers: init.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          done({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    request.on("error", fail);
    request.end(init.body);
  });
}

const fresh = () => {
  seen = [];
  logs = [];
  resolveCalls = [];
};

test("a tunnel to a name that is not on the allowlist gets 403 and a log line", async () => {
  fresh();
  const { status, socket } = await connect(proxy, "evil.test:443");
  socket.destroy();
  assert.equal(status, 403);
  assert.deepEqual(
    logs.map(({ kind, host, port, method, status: code, bytes, reason }) => ({
      kind,
      host,
      port,
      method,
      status: code,
      bytes,
      reason,
    })),
    [
      {
        kind: "connect",
        host: "evil.test",
        port: 443,
        method: "CONNECT",
        status: 403,
        bytes: 0,
        reason: "not_allowed",
      },
    ],
  );
  assert.deepEqual(resolveCalls, [], "the name was refused before it was looked up");
});

test("an allowed name on another port, an address literal and a malformed target are refused", async () => {
  fresh();
  for (const target of [
    `upstream.test:${upstreamPort + 1}`,
    "127.0.0.1:443",
    "[::1]:443",
    "93.184.216.34:443",
    "upstream.test",
    "x:y:z",
    "a.wild.test:443/extra",
  ]) {
    const { status, socket } = await connect(proxy, target);
    socket.destroy();
    assert.equal(status, 403, target);
  }
  assert.deepEqual(resolveCalls, [], "none of these was looked up");
  assert.ok(logs.every((record) => record.status === 403 && record.bytes === 0));
});

test("an allowed name that resolves to loopback, metadata, private or mapped addresses is refused", async () => {
  const isolated = await startEgressProxy({
    allow: ["metadata.test", "loopback.test", "private.test", "mixed.test", "v6.test", "mapped.test"],
    log: (record) => logs.push(record),
    resolve,
  });
  try {
    fresh();
    for (const name of ["metadata.test", "loopback.test", "private.test", "mixed.test", "v6.test", "mapped.test"]) {
      const { status, socket } = await connect(isolated, `${name}:443`);
      socket.destroy();
      assert.equal(status, 502, `${name} must not be connected to`);
    }
    assert.deepEqual(new Set(logs.map((record) => record.reason)), new Set(["address_refused"]));
    assert.ok(logs.every((record) => record.bytes === 0));
  } finally {
    await isolated.close();
  }
});

test("an allowed name is reached through a tunnel, at the address the proxy checked, and the log counts the bytes", async () => {
  fresh();
  const { status, socket } = await connect(proxy, `upstream.test:${upstreamPort}`);
  assert.equal(status, 200);
  const secure = tls.connect({ socket, servername: "upstream.test", ca: certificate });
  const text = await new Promise<string>((done, fail) => {
    let out = "";
    secure.on("secureConnect", () =>
      secure.write("GET /through-tunnel HTTP/1.1\r\nHost: upstream.test\r\nConnection: close\r\n\r\n"),
    );
    secure.on("data", (chunk) => (out += chunk.toString()));
    secure.on("end", () => done(out));
    secure.on("error", fail);
  });
  assert.match(text, /^HTTP\/1\.1 200/);
  assert.equal(seen[0]?.url, "/through-tunnel");
  await new Promise((done) => setTimeout(done, 100));
  const record = logs.find((entry) => entry.kind === "connect" && entry.status === 200);
  assert.ok(record !== undefined && record.bytes > 2000, "the tunnel's bytes are counted");
  assert.deepEqual(resolveCalls, ["upstream.test"], "the name was resolved once, and the connection used that answer");
});

test("a name that answers differently the second time can't redirect a connection that was checked", async () => {
  fresh();
  let calls = 0;
  const rebinding = await startEgressProxy({
    allow: [`rebind.test:${upstreamPort}`],
    log: (record) => logs.push(record),
    resolve: async () => (++calls === 1 ? ["127.0.0.1"] : ["10.0.0.9"]),
    unsafeAllowAddresses: ["127.0.0.1"],
  });
  try {
    const { status, socket } = await connect(rebinding, `rebind.test:${upstreamPort}`);
    assert.equal(status, 200);
    socket.destroy();
    assert.equal(calls, 1, "the proxy resolved once, so the checked address is the one it connected to");
  } finally {
    await rebinding.close();
  }
});

test("a route request with the right sentinel and method reaches the upstream with the real header", async () => {
  fresh();
  const reply = await routeRequest(proxy, "/svc/repos/x?page=2", {
    headers: { authorization: `Bearer ${proxy.sentinels.svc}`, accept: "application/json" },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["x-upstream"], "yes");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, "/repos/x?page=2");
  assert.equal(
    seen[0]?.headers.authorization,
    `Bearer ${SECRET}`,
    "the upstream got the real credential in place of the sentinel",
  );
  assert.equal(seen[0]?.headers.host, `upstream.test:${upstreamPort}`);
  assert.equal(seen[0]?.headers.accept, "application/json");
  assert.deepEqual(
    logs.filter((record) => record.kind === "route").map((record) => [record.route, record.method, record.status]),
    [["svc", "GET", 200]],
  );
  assert.ok((logs.find((record) => record.kind === "route")?.bytes ?? 0) > 2000);
});

test("a request body reaches the upstream, and a route with another header injects there", async () => {
  fresh();
  const posted = await routeRequest(proxy, "/svc/issues", {
    method: "POST",
    headers: { authorization: `token ${proxy.sentinels.svc}`, "content-type": "application/json" },
    body: '{"title":"t"}',
  });
  assert.equal(posted.status, 200);
  assert.equal(seen[0]?.method, "POST");
  assert.equal(seen[0]?.body, '{"title":"t"}');
  assert.equal(seen[0]?.headers.authorization, `token ${SECRET}`);
  const keyed = await routeRequest(proxy, "/readonly/x", { headers: { "x-api-key": proxy.sentinels.readonly ?? "" } });
  assert.equal(keyed.status, 200);
  assert.equal(seen[1]?.headers["x-api-key"], SECRET);
});

test("a method the route doesn't allow is refused, and nothing reaches the upstream", async () => {
  fresh();
  const reply = await routeRequest(proxy, "/readonly/x", {
    method: "POST",
    headers: { "x-api-key": proxy.sentinels.readonly ?? "" },
    body: "x",
  });
  assert.equal(reply.status, 405);
  const deleted = await routeRequest(proxy, "/svc/x", {
    method: "DELETE",
    headers: { authorization: `Bearer ${proxy.sentinels.svc}` },
  });
  assert.equal(deleted.status, 405);
  assert.equal(seen.length, 0);
  assert.deepEqual(
    logs.map((record) => record.reason),
    ["method_not_allowed", "method_not_allowed"],
  );
});

test("a wrong, missing or borrowed sentinel is refused, and so is an unknown route", async () => {
  fresh();
  const attempts: [string, Record<string, string>][] = [
    ["/svc/x", {}],
    ["/svc/x", { authorization: "Bearer not-the-sentinel" }],
    ["/svc/x", { authorization: `Bearer ${proxy.sentinels.readonly}` }],
    ["/svc/x", { "x-api-key": proxy.sentinels.svc ?? "" }],
    ["/nope/x", { authorization: `Bearer ${proxy.sentinels.svc}` }],
    ["/", {}],
  ];
  for (const [path, headers] of attempts) {
    const reply = await routeRequest(proxy, path, { headers });
    assert.equal(reply.status, 403, `${path} ${JSON.stringify(headers)}`);
  }
  assert.equal(seen.length, 0, "no refused request reached the upstream");
});

test("an HTTP proxy request in absolute form is refused: only a tunnel may leave", async () => {
  fresh();
  const { port } = new URL(proxy.url);
  const status = await new Promise<number>((done, fail) => {
    http
      .request(
        {
          host: "127.0.0.1",
          port: Number(port),
          path: "http://upstream.test/anything",
          headers: { host: "upstream.test" },
        },
        (response) => {
          response.resume();
          done(response.statusCode ?? 0);
        },
      )
      .on("error", fail)
      .end();
  });
  assert.equal(status, 403);
  assert.equal(logs.find((record) => record.reason === "only_connect")?.status, 403);
});

test("the real secret appears in no log line, no response to the sandbox and no scrubbed entry", async () => {
  fresh();
  const reply = await routeRequest(proxy, "/svc/echo", { headers: { authorization: `Bearer ${proxy.sentinels.svc}` } });
  const sandboxEnvironment = { SVC_TOKEN: proxy.sentinels.svc ?? "", PATH: "/usr/bin" };
  assert.ok(!JSON.stringify([reply, logs, sandboxEnvironment]).includes(SECRET));
  assert.ok(Object.values(sandboxEnvironment).every((value) => !value.includes(SECRET)));
  const entry = {
    type: "tool_result",
    id: "t1",
    parentId: null,
    seq: 0,
    timestamp: "2026-11-22T08:00:00.000Z",
    origin: "tool",
    content: `got ${SECRET}`,
  } as unknown as SessionEntry;
  assert.ok(!JSON.stringify(scrubSecrets(entry, await proxy.knownSecrets())).includes(SECRET));
  assert.deepEqual(await proxy.knownSecrets(), [SECRET]);
});

test("fetch reaches an allowed host, and refuses a host that is not on the allowlist", async () => {
  fresh();
  const reply = await proxy.fetch(`https://upstream.test:${upstreamPort}/from-fetch`, {
    method: "POST",
    body: "payload",
    headers: { "x-extra": "1" },
  });
  assert.equal(reply.status, 200);
  assert.equal(((await reply.json()) as { ok: boolean }).ok, true);
  assert.equal(seen[0]?.body, "payload");
  assert.equal(seen[0]?.headers["x-extra"], "1");
  assert.equal(logs.find((record) => record.kind === "fetch")?.status, 200);
  for (const url of [
    "https://evil.test/",
    `https://upstream.test:${upstreamPort + 1}/`,
    "https://127.0.0.1/",
    "http://upstream.test/",
    "https://[::1]/",
  ]) {
    const error = await proxy.fetch(url).catch((caught: unknown) => caught);
    assert.equal((error as { code?: string }).code, "egress_denied", url);
  }
  assert.equal(seen.length, 1, "no refused fetch reached the upstream");
  assert.ok(logs.filter((record) => record.status === 403).length >= 5);
});

test("fetch to a route URL injects the secret like any route request, and refuses a bad sentinel", async () => {
  fresh();
  const good = await proxy.fetch(`${proxy.url}/svc/via-fetch`, {
    headers: { authorization: `Bearer ${proxy.sentinels.svc}` },
  });
  assert.equal(good.status, 200);
  assert.equal(seen[0]?.headers.authorization, `Bearer ${SECRET}`);
  const bad = await proxy.fetch(`${proxy.url}/svc/via-fetch`, { headers: { authorization: "Bearer nope" } });
  assert.equal(bad.status, 403);
  assert.equal(seen.length, 1);
});

test("a name that doesn't resolve, or a certificate the proxy doesn't trust, fails with 502 and is logged", async () => {
  fresh();
  const { status, socket } = await connect(proxy, "x.wild.test:443");
  socket.destroy();
  assert.equal(status, 502);
  assert.equal(logs.find((record) => record.host === "x.wild.test")?.reason, "connect_failed");
  const untrusted = await startEgressProxy({
    allow: [],
    routes: [
      {
        route: "svc",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => SECRET,
      },
    ],
    log: (record) => logs.push(record),
    resolve,
    unsafeAllowAddresses: ["127.0.0.1"],
  });
  try {
    const reply = await routeRequest(untrusted, "/svc/x", {
      headers: { authorization: `Bearer ${untrusted.sentinels.svc}` },
    });
    assert.equal(reply.status, 502, "the self-signed certificate is not trusted without the test's ca");
    assert.equal(seen.length, 0);
  } finally {
    await untrusted.close();
  }
});

test("a secret that can't be read, or holds a line break, is a 502 and nothing is sent", async () => {
  fresh();
  const broken = await startEgressProxy({
    allow: [],
    routes: [
      {
        route: "gone",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => {
          throw new Error("vault down");
        },
      },
      {
        route: "crlf",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => "abc\r\nX-Injected: 1",
      },
    ],
    log: (record) => logs.push(record),
    resolve,
    ca: certificate,
    unsafeAllowAddresses: ["127.0.0.1"],
  });
  try {
    for (const route of ["gone", "crlf"]) {
      const reply = await routeRequest(broken, `/${route}/x`, {
        headers: { authorization: `Bearer ${broken.sentinels[route]}` },
      });
      assert.equal(reply.status, 502, route);
    }
    assert.equal(seen.length, 0);
    assert.ok(!JSON.stringify(logs).includes("vault down"), "an error message from the secret function is not logged");
  } finally {
    await broken.close();
  }
});

test("a client that goes away mid-response, and many requests at once, don't disturb the proxy", async () => {
  fresh();
  const { port } = new URL(proxy.url);
  await new Promise<void>((done) => {
    const request = http.request({
      host: "127.0.0.1",
      port: Number(port),
      path: "/svc/x",
      headers: { authorization: `Bearer ${proxy.sentinels.svc}` },
    });
    request.on("response", (response) => {
      response.once("data", () => {
        request.destroy();
        done();
      });
    });
    request.on("error", () => done());
    request.end();
  });
  const replies = await Promise.all(
    Array.from({ length: 20 }, () =>
      routeRequest(proxy, "/svc/parallel", { headers: { authorization: `Bearer ${proxy.sentinels.svc}` } }),
    ),
  );
  assert.ok(replies.every((reply) => reply.status === 200));
});

test("a proxy on a Unix socket serves routes, for a container that mounts it", async () => {
  const folder = mkdtempSync(join(tmpdir(), "harness-egress-sock-"));
  folders.push(folder);
  const socketPath = join(folder, "proxy.sock");
  const onSocket = await startEgressProxy({
    allow: [],
    routes: [
      {
        route: "svc",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => SECRET,
      },
    ],
    log: (record) => logs.push(record),
    resolve,
    ca: certificate,
    unsafeAllowAddresses: ["127.0.0.1"],
    socketPath,
  });
  try {
    fresh();
    assert.equal(onSocket.socketPath, socketPath);
    const status = await new Promise<number>((done, fail) => {
      http
        .request(
          { socketPath, path: "/svc/on-socket", headers: { authorization: `Bearer ${onSocket.sentinels.svc}` } },
          (response) => {
            response.resume();
            done(response.statusCode ?? 0);
          },
        )
        .on("error", fail)
        .end();
    });
    assert.equal(status, 200);
    assert.equal(seen[0]?.headers.authorization, `Bearer ${SECRET}`);
  } finally {
    await onSocket.close();
  }
});

test("close stops listening and ends open tunnels", async () => {
  const closing = await startEgressProxy({
    allow: [`upstream.test:${upstreamPort}`],
    log: () => {},
    resolve,
    unsafeAllowAddresses: ["127.0.0.1"],
  });
  const { status, socket } = await connect(closing, `upstream.test:${upstreamPort}`);
  assert.equal(status, 200);
  const closed = new Promise<void>((done) => socket.once("close", () => done()));
  const { port } = new URL(closing.url);
  await closing.close();
  await closed;
  const refused = await new Promise<string>((done) => {
    const attempt = net.connect(Number(port), "127.0.0.1");
    attempt.once("error", (error) => done((error as NodeJS.ErrnoException).code ?? ""));
    attempt.once("connect", () => done("connected"));
  });
  assert.equal(refused, "ECONNREFUSED");
});

test("a bad allowlist entry or route is refused when the proxy starts", async () => {
  const route = {
    route: "ok",
    host: "api.example.com",
    methods: ["GET"],
    header: "authorization",
    secret: async () => "x",
  };
  const bad: [string, Parameters<typeof startEgressProxy>[0]][] = [
    ["an address in the allowlist", { allow: ["10.0.0.1"], log: () => {} }],
    ["a bare star", { allow: ["*"], log: () => {} }],
    ["an IPv6 literal", { allow: ["[::1]"], log: () => {} }],
    ["a bad port", { allow: ["example.com:99999"], log: () => {} }],
    ["a path in an entry", { allow: ["example.com/x"], log: () => {} }],
    ["two routes with one name", { allow: [], routes: [route, route], log: () => {} }],
    ["a route name with a slash", { allow: [], routes: [{ ...route, route: "a/b" }], log: () => {} }],
    ["a route on an address", { allow: [], routes: [{ ...route, host: "127.0.0.1" }], log: () => {} }],
    ["a route with no methods", { allow: [], routes: [{ ...route, methods: [] }], log: () => {} }],
    ["a route that allows CONNECT", { allow: [], routes: [{ ...route, methods: ["CONNECT"] }], log: () => {} }],
    ["a route whose header is host", { allow: [], routes: [{ ...route, header: "Host" }], log: () => {} }],
    ["a route whose header has a space", { allow: [], routes: [{ ...route, header: "x y" }], log: () => {} }],
  ];
  for (const [label, options] of bad) {
    const error = await startEgressProxy(options).catch((caught: unknown) => caught);
    assert.equal((error as { code?: string }).code, "invalid_egress_options", `${label} must be refused`);
  }
});

test("a secret with a character Node refuses in a header is a 502, and the proxy carries on", async () => {
  fresh();
  const odd = await startEgressProxy({
    allow: [],
    routes: [
      {
        route: "del",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => "tok\x7fen",
      },
      {
        route: "wide",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => "tok\u0100en",
      },
      {
        route: "ok",
        host: `upstream.test:${upstreamPort}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => "fine-token",
      },
    ],
    log: (record) => logs.push(record),
    resolve,
    ca: certificate,
    unsafeAllowAddresses: ["127.0.0.1"],
  });
  try {
    for (const route of ["del", "wide"]) {
      const reply = await routeRequest(odd, `/${route}/x`, {
        headers: { authorization: `Bearer ${odd.sentinels[route]}` },
      });
      assert.equal(reply.status, 502, route);
    }
    const good = await routeRequest(odd, "/ok/x", { headers: { authorization: `Bearer ${odd.sentinels.ok}` } });
    assert.equal(good.status, 200, "the proxy is still serving");
    assert.equal(seen.length, 1);
  } finally {
    await odd.close();
  }
});

test("a tunnel whose name never resolves times out with a 502 and a log record", async () => {
  fresh();
  const stuck = await startEgressProxy({
    allow: ["stuck.test"],
    log: (record) => logs.push(record),
    resolve: () => new Promise(() => {}),
    idleTimeoutMs: 200,
  });
  try {
    const started = Date.now();
    const { status, socket } = await connect(stuck, "stuck.test:443");
    socket.destroy();
    assert.equal(status, 502);
    assert.ok(Date.now() - started < 3000);
    assert.equal(logs.find((record) => record.host === "stuck.test")?.reason, "timeout");
  } finally {
    await stuck.close();
  }
});

test("a fetch whose response has no body, or is never read, is still logged", async () => {
  fresh();
  const none = await proxy.fetch(`https://upstream.test:${upstreamPort}/nobody`);
  assert.equal(none.status, 204);
  const head = await proxy.fetch(`https://upstream.test:${upstreamPort}/unread`, { method: "POST", body: "x" });
  assert.equal(head.status, 200);
  await new Promise((done) => setTimeout(done, 300));
  assert.ok(
    logs.some((record) => record.kind === "fetch" && record.status === 204),
    "the 204 was logged",
  );
  await head.body?.cancel();
  await new Promise((done) => setTimeout(done, 300));
  assert.ok(
    logs.some((record) => record.kind === "fetch" && record.status === 200),
    "the unread response was logged once it ended",
  );
});

test("many requests on one keep-alive connection add no listeners that pile up", async () => {
  fresh();
  const warnings: string[] = [];
  const onWarning = (warning: Error) => warnings.push(warning.name);
  process.on("warning", onWarning);
  const { port } = new URL(proxy.url);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    for (let index = 0; index < 30; index += 1) {
      await new Promise<void>((done, fail) => {
        http
          .request(
            {
              host: "127.0.0.1",
              port: Number(port),
              path: "/svc/keep",
              agent,
              headers: { authorization: `Bearer ${proxy.sentinels.svc}` },
            },
            (response) => {
              response.resume();
              response.on("end", () => done());
            },
          )
          .on("error", fail)
          .end();
      });
    }
  } finally {
    agent.destroy();
    process.off("warning", onWarning);
  }
  assert.deepEqual(
    warnings.filter((name) => name === "MaxListenersExceededWarning"),
    [],
  );
});

test("a fetch with an aborted signal rejects with the abort reason, before or during the request", async () => {
  fresh();
  const early = new AbortController();
  early.abort(new Error("already"));
  const before = await proxy
    .fetch(`https://upstream.test:${upstreamPort}/x`, { signal: early.signal })
    .catch((caught: unknown) => caught);
  assert.equal((before as Error).message, "already");
  assert.equal(seen.length, 0);
  const late = new AbortController();
  const pending = proxy
    .fetch(`https://upstream.test:${upstreamPort}/slow`, { signal: late.signal })
    .catch((caught: unknown) => caught);
  setTimeout(() => late.abort(new Error("changed my mind")), 100);
  assert.equal(((await pending) as Error).message, "changed my mind");
});

test("a route request is reached in process at the virtual origin as well as the proxy's address", async () => {
  fresh();
  const reply = await proxy.fetch("http://egress.proxy/svc/virtual", {
    headers: { authorization: `Bearer ${proxy.sentinels.svc}` },
  });
  assert.equal(reply.status, 200);
  assert.equal(seen[0]?.headers.authorization, `Bearer ${SECRET}`);
});

test("a client that disconnects takes the upstream request with it", async () => {
  fresh();
  slowClosed = false;
  const { port } = new URL(proxy.url);
  await new Promise<void>((done) => {
    const request = http.request({
      host: "127.0.0.1",
      port: Number(port),
      path: "/svc/slow",
      headers: { authorization: `Bearer ${proxy.sentinels.svc}` },
    });
    request.on("error", () => {});
    request.end();
    setTimeout(() => {
      request.destroy();
      done();
    }, 200);
  });
  for (let tries = 0; tries < 30 && !slowClosed; tries += 1) await new Promise((done) => setTimeout(done, 50));
  assert.equal(slowClosed, true, "the upstream saw its connection close long before its 1.5 s delay");
});
