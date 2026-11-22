// An upstream that answers with a status the Web `Response` refuses, outside 200 to 599, must fail the proxy's fetch
// and its routes with an error, never with an exception thrown inside a socket handler, which would end the process.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { type EgressProxy, type EgressRecord, startEgressProxy } from "@buildanagent/harness/credentials";
import { afterAll, beforeAll, test } from "vitest";

let folder = "";
let server: tls.Server;
let proxy: EgressProxy;
let port = 0;
let closedHeld = 0;
const records: EgressRecord[] = [];

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "harness-proxy-status-"));
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"],
      ...["-keyout", join(folder, "key.pem"), "-out", join(folder, "cert.pem")],
      ...["-subj", "/CN=upstream.test", "-addext", "subjectAltName=DNS:upstream.test"],
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(join(folder, "cert.pem"), "utf8");
  const key = readFileSync(join(folder, "key.pem"), "utf8");
  // The status comes from the request path, /<status>, and the socket closes after the answer.
  // A path under /hold/ answers and keeps its socket open, so only the proxy can close it.
  server = tls.createServer({ key, cert }, (socket) => {
    socket.once("data", (chunk) => {
      const line = chunk.toString();
      const status = /^\w+ \/(?:odd\/)?(?:hold\/)?(\d+)/.exec(line)?.[1] ?? "200";
      const answer = `HTTP/1.1 ${status} Odd\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{}`;
      if (line.includes("/204body")) {
        socket.end("HTTP/1.1 204 No Content\r\ncontent-length: 5\r\n\r\nhello");
        return;
      }
      if (line.includes("/hold/")) {
        socket.write(answer);
        socket.once("close", () => {
          closedHeld += 1;
        });
      } else socket.end(answer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  proxy = await startEgressProxy({
    allow: [`upstream.test:${port}`],
    routes: [
      {
        route: "odd",
        host: `upstream.test:${port}`,
        methods: ["GET"],
        header: "authorization",
        secret: async () => "upstream-secret",
      },
    ],
    log: (record) => records.push(record),
    ca: cert,
    resolve: async () => ["127.0.0.1"],
    unsafeAllowAddresses: ["127.0.0.1"],
  });
});

afterAll(async () => {
  await proxy?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

/** How a fetch settled: its status, or its error's message. */
const settle = (fetching: Promise<Response>) =>
  fetching.then(
    async (response) => {
      await response.body?.cancel();
      return `status ${response.status}`;
    },
    (error: unknown) => `error ${error instanceof Error ? error.message : String(error)}`,
  );

test("the fetch rejects a status outside 200 to 599 and still passes 200", async () => {
  for (const status of [999, 600]) {
    const outcome = await settle(proxy.fetch(`https://upstream.test:${port}/${status}`));
    assert.match(outcome, new RegExp(`^error the upstream answered with status ${status}`), outcome);
  }
  // Node takes a 101 for an upgrade and a 199 for an early answer, so neither reaches a Response; each still fails.
  for (const status of [101, 199]) {
    const outcome = await settle(proxy.fetch(`https://upstream.test:${port}/${status}`));
    assert.match(outcome, /^error /, `status ${status}: ${outcome}`);
  }
  assert.equal(await settle(proxy.fetch(`https://upstream.test:${port}/200`)), "status 200");
});

test("a route rejects a status outside 200 to 599 and still passes 200", async () => {
  const sentinel = proxy.sentinels.odd ?? "";
  const through = (status: number | string) =>
    settle(proxy.fetch(`${proxy.url}/odd/${status}`, { headers: { authorization: `Bearer ${sentinel}` } }));
  for (const status of [999, 600]) {
    assert.match(await through(status), new RegExp(`^error the upstream answered with status ${status}`));
  }
  assert.equal(await through(200), "status 200");
  // The refused reply is destroyed, so its upstream socket closes and is not left waiting for a reader.
  const before = closedHeld;
  assert.match(await through("hold/999"), /^error /);
  const until = Date.now() + 2000;
  while (closedHeld === before && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(closedHeld, before + 1);
});

test("the log says why a status was refused, and an answer that breaks after it starts is logged once", async () => {
  const before = records.length;
  await settle(proxy.fetch(`https://upstream.test:${port}/999`));
  const until = Date.now() + 2000;
  while (records.length === before && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
  const refused = records.slice(before);
  assert.equal(refused.length, 1);
  assert.equal(refused[0]?.reason, "bad_status");
  const routeMark = records.length;
  const sentinel = proxy.sentinels.odd ?? "";
  await settle(proxy.fetch(`${proxy.url}/odd/999`, { headers: { authorization: `Bearer ${sentinel}` } }));
  const routeUntil = Date.now() + 2000;
  while (records.length === routeMark && Date.now() < routeUntil)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(records.at(-1)?.reason, "bad_status");
  const mark = records.length;
  assert.equal(await settle(proxy.fetch(`https://upstream.test:${port}/204body`)), "status 204");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(records.length - mark, 1, JSON.stringify(records.slice(mark)));
});
