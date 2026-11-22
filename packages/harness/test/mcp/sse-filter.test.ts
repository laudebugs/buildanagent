// The guarded fetch on its own, over a scripted network: what it passes of an event stream byte for byte, what it drops
// (the server's `retry` field, an event id the client could not send back, a byte order mark), where it lets a request
// go, and which headers it sends.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { guardedFetch } from "../../src/mcp/guarded-fetch.js";
import { checkRemoteTransport } from "../../src/mcp/remote-config.js";

const settings = checkRemoteTransport({
  kind: "http",
  url: "https://mcp.example.test/mcp",
  headers: { Authorization: "Bearer configured" },
});

/** The text an event stream reads as after the guard, sent in the given chunks. */
async function filtered(chunks: readonly (string | Uint8Array)[]): Promise<string> {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
  const fetch = guardedFetch(
    async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    settings,
    { log: () => {} },
  );
  return (await fetch("https://mcp.example.test/mcp", { method: "POST", body: "{}" })).text();
}

describe("the event-stream filter", () => {
  test("drops every retry line, with any line end, and passes every other line as it came, ended by LF", async () => {
    assert.equal(await filtered(["retry: 0\ndata: a\n\n"]), "data: a\n\n");
    assert.equal(await filtered(["data: a\r\nretry: 1\r\n\r\n"]), "data: a\n\n");
    assert.equal(await filtered(["retry:5\rdata: b\r\r"]), "data: b\n\n");
    assert.equal(await filtered(["retry\n: comment\n\n"]), ": comment\n\n");
    // A field that only starts with the word is another field, and stays.
    assert.equal(await filtered(["retryx: 1\n\n"]), "retryx: 1\n\n");
  });

  test("reads a CRLF split across chunks as one line end, and never joins two line ends by dropping a line", async () => {
    assert.equal(await filtered(["retry: 0\r", "\ndata: a\n\n"]), "data: a\n\n");
    assert.equal(await filtered(["data: a\r", "\n\n"]), "data: a\n\n");
    // The blank line that ends the event survives the dropped line before it.
    assert.equal(await filtered(["data: a\r", "retry: 3\r", "\n\n"]), "data: a\n\n");
    assert.equal(await filtered(["data: a\rretry: 3\r\n\r\n"]), "data: a\n\n");
    assert.equal(await filtered(["re", "try: 9", "\ndata: c\n\n"]), "data: c\n\n");
  });

  test("drops an event id the client could not send back, and keeps a short printable one", async () => {
    assert.equal(await filtered([`id: ${"x".repeat(257)}\ndata: a\n\n`]), "data: a\n\n");
    assert.equal(await filtered(["id: café\ndata: a\n\n"]), "data: a\n\n");
    assert.equal(await filtered(["id: 42\ndata: a\n\n"]), "id: 42\ndata: a\n\n");
  });

  test("drops a byte order mark split across chunks, and passes a first chunk that only starts like one", async () => {
    const bytes = (...parts: (number[] | string)[]) =>
      new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...new TextEncoder().encode(part)] : part)));
    assert.equal(await filtered([bytes([0xef]), bytes([0xbb, 0xbf], "retry: 987654\ndata: a\n\n")]), "data: a\n\n");
    assert.equal(
      await filtered([bytes([0xef, 0xbb]), bytes([0xbf], `id: ${"x".repeat(5000)}\ndata: a\n\n`)]),
      "data: a\n\n",
    );
    assert.equal(await filtered([bytes([0xef]), bytes([0xbb]), bytes([0xbf], "data: a\n\n")]), "data: a\n\n");
    assert.equal(await filtered(["d", "ata: a\n\n"]), "data: a\n\n");
    assert.equal(await filtered([bytes([0xef]), bytes("x\n\n")]), "\uFFFDx\n\n");
  });

  test("an empty chunk between a CR and its LF keeps them one line end", async () => {
    assert.equal(await filtered(["data: a\r", "", "\ndata: b\n\n"]), "data: a\ndata: b\n\n");
  });

  test("drops a byte order mark at the start, so the first field still reads as a field", async () => {
    assert.equal(await filtered(["﻿retry: 0\ndata: a\n\n"]), "data: a\n\n");
    assert.equal(await filtered(["﻿", "data: a\n\n"]), "data: a\n\n");
  });
});

describe("the request", () => {
  test("goes to the configured origin only, with no user name, and follows no redirect itself", async () => {
    const seen: string[] = [];
    const fetch = guardedFetch(
      async (input, init) => {
        seen.push(`${String(input)} ${init?.redirect}`);
        return new Response("{}", { headers: { "content-type": "application/json" } });
      },
      settings,
      { log: () => {} },
    );
    await assert.rejects(fetch("https://elsewhere.test/mcp"), /left the server's origin/);
    await assert.rejects(fetch("https://mcp.example.test:444/mcp"), /left the server's origin/);
    await assert.rejects(fetch("http://mcp.example.test/mcp"), /left the server's origin/);
    await assert.rejects(fetch("https://u:p@mcp.example.test/mcp"), /left the server's origin/);
    await fetch("https://mcp.example.test/messages?session=1");
    assert.deepEqual(seen, ["https://mcp.example.test/messages?session=1 manual"]);
  });

  test("sends the configured headers over the client's own, and answers a bodiless status with no body", async () => {
    let headers: Headers | undefined;
    const fetch = guardedFetch(
      async (_input, init) => {
        headers = new Headers(init?.headers);
        return new Response(null, { status: 202 });
      },
      settings,
      { log: () => {} },
    );
    const response = await fetch("https://mcp.example.test/mcp", { headers: { authorization: "Bearer library" } });
    assert.equal(headers?.get("authorization"), "Bearer configured");
    assert.equal(response.status, 202);
    assert.equal(response.body, null);
  });
});

describe("an open line sent a byte at a time", () => {
  test("costs about its own bytes, not a piece per chunk", () => {
    const script = fileURLToPath(new URL("./filter-memory.ts", import.meta.url));
    const run = spawnSync(process.execPath, ["--expose-gc", "--import", "tsx", script, String(2_000_000)], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), TMPDIR: tmpdir(), LANG: "C" },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(run.status, 0, run.stderr);
    const retained = Number(run.stdout.trim());
    // The line is 2 MB; a buffer that doubles holds at most twice that, and a piece per byte held hundreds of MB.
    assert.ok(retained < 16 * 1024 * 1024, `${(retained / 1048576).toFixed(1)} MiB retained for a 2 MB line`);
  }, 70_000);
});
