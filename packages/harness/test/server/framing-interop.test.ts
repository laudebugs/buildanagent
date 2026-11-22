// HD6's settling test: two JSON-RPC libraries we did not write read every message our stdio server sends, with no
// adapter between them and the stream. `json-rpc-2.0` is a generic JSON-RPC 2.0 peer that leaves framing to its
// caller, so the only glue is splitting on `\n`, which is the framing itself. `@modelcontextprotocol/client` brings its
// own stdio framing, `ReadBuffer`, which checks each message against MCP's strict JSON-RPC schema. Its
// `StdioClientTransport` is not used, because it spawns the server with parent variables such as USER and SHELL added
// to the environment it is given, and the child must get only `spawnEnv()`'s.
import assert from "node:assert/strict";
import { deserializeMessage, type JSONRPCMessage, ReadBuffer, serializeMessage } from "@modelcontextprotocol/client";
import { isJSONRPCResponse, JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { describe, test } from "vitest";
import { initialize, type StdioChild, spawnServer, waitUntil } from "./stdio-child.js";

const TIMEOUT = 60_000;
const text = (value: string) => [{ type: "text", text: value }];

interface ApprovalParams {
  readonly request: { readonly id: string };
}

/** The resolution that allows the refund the server asks about. */
const allow = (params: ApprovalParams) => ({
  resolutions: [{ requestId: params.request.id, decision: "allow", by: "ada" }],
});

const settledCount = (methods: readonly string[]) => methods.filter((method) => method === "turn/settled").length;

describe("json-rpc-2.0, a generic JSON-RPC 2.0 peer", () => {
  test(
    "reads every message of a turn that asks for approval, and answers the server's request",
    async () => {
      const child = spawnServer("approval");
      const invalid: unknown[] = [];
      const received: string[] = [];
      const peer = new JSONRPCServerAndClient(
        new JSONRPCServer({ errorListener: (message, data) => invalid.push([message, data]) }),
        new JSONRPCClient((request) => child.send(request)),
        { errorListener: (message, data) => invalid.push([message, data]) },
      );
      for (const method of ["event", "turn/settled", "$/cancelRequest"]) {
        peer.addMethod(method, () => {
          received.push(method);
        });
      }
      peer.addMethod("approval/request", (params) => {
        received.push("approval/request");
        return allow(params as unknown as ApprovalParams);
      });
      let handled = 0;
      const failures: unknown[] = [];
      let at = 0;
      child.onChunk(() => {
        // `lines` already holds the chunk's complete lines; hand each to the peer once.
        for (; at < child.lines.length; at += 1) {
          peer.receiveAndSend(JSON.parse(child.lines[at] as string), undefined, undefined).then(
            () => {
              handled += 1;
            },
            (error: unknown) => failures.push(error),
          );
        }
      });

      const init = await peer.request("initialize", initialize(0).params, undefined);
      assert.equal(init.serverInfo.specVersion, "v1");
      assert.deepEqual(await peer.request("session/create", { session: "s1", cwd: "/work" }, undefined), {
        session: "s1",
        head: null,
      });
      const disposition = await peer.request("turn/start", { session: "s1", input: text("refund o1") }, undefined);
      assert.equal(disposition.accepted, true);
      // An error response reaches the caller as the library's own error, with our code.
      await assert.rejects(Promise.resolve(peer.request("nope/nothing", {}, undefined)), (error: { code?: number }) => {
        assert.equal(error.code, -32601);
        return true;
      });
      // The paused turn settles, the peer allows the refund, and the resume settles too.
      await waitUntil(child, () => settledCount(received) === 2, "two turn/settled");
      await waitUntil(child, () => handled + failures.length === child.lines.length, "every line handled");

      assert.deepEqual(failures, []);
      assert.deepEqual(invalid, []);
      assert.equal(received.filter((method) => method === "approval/request").length, 1);
      assert.ok(received.filter((method) => method === "event").length > 10);
      child.end();
      assert.equal(await child.exited, 0);
    },
    TIMEOUT,
  );
});

describe("the JSON-RPC layer of @modelcontextprotocol/client", () => {
  test(
    "its ReadBuffer reads every message of the same turn against MCP's strict schema",
    async () => {
      const child = spawnServer("approval");
      const buffer = new ReadBuffer();
      const messages: JSONRPCMessage[] = [];
      const failures: unknown[] = [];
      const send = (message: JSONRPCMessage) => child.write(serializeMessage(message));
      child.onChunk((chunk) => {
        buffer.append(chunk);
        try {
          for (let message = buffer.readMessage(); message !== null; message = buffer.readMessage()) {
            messages.push(message);
            if ("method" in message && "id" in message && message.method === "approval/request") {
              send({ jsonrpc: "2.0", id: message.id, result: allow(message.params as unknown as ApprovalParams) });
            }
          }
        } catch (error) {
          failures.push(error);
        }
      });
      const result = (id: number) =>
        messages.find((message) => !("method" in message) && "id" in message && message.id === id);
      const methods = () => messages.flatMap((message) => ("method" in message ? [message.method] : []));

      send(initialize(1) as JSONRPCMessage);
      await waitUntil(child, () => result(1) !== undefined, "the response to 1");
      send({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/work" } });
      await waitUntil(child, () => result(2) !== undefined, "the response to 2");
      send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: text("refund o1") } });
      send({ jsonrpc: "2.0", id: 4, method: "nope/nothing", params: {} });
      await waitUntil(child, () => settledCount(methods()) === 2, "two turn/settled");

      assert.deepEqual(failures, []);
      // ReadBuffer skips a line that is not JSON without a word, so the count shows it skipped none.
      assert.equal(messages.length, child.lines.length);
      const unknown = result(4);
      assert.ok(unknown !== undefined && "error" in unknown && unknown.error.code === -32601);
      assert.equal(methods().filter((method) => method === "approval/request").length, 1);
      child.end();
      assert.equal(await child.exited, 0);
    },
    TIMEOUT,
  );
});

describe("the one message MCP's schema refuses", () => {
  test(
    "is the error for an unreadable line, whose id JSON-RPC 2.0 requires to be null",
    async () => {
      const child: StdioChild = spawnServer("basic");
      child.write("not json\n");
      await waitUntil(child, () => child.lines.length === 1, "the error response");
      const [line] = child.lines as [string];
      const parsed = JSON.parse(line);
      assert.equal(parsed.id, null);
      assert.equal(parsed.error.code, -32700);
      // The generic peer reads it as a response to no request; MCP's schema allows an absent id but not a null one.
      assert.equal(isJSONRPCResponse(parsed), true);
      assert.throws(() => deserializeMessage(line));
      child.end();
      assert.equal(await child.exited, 0);
    },
    TIMEOUT,
  );
});
