// HD6's framing check over the WebSocket transport: the two JSON-RPC libraries of framing-interop.test.ts read every
// frame the server sends, with no adapter between them and the socket. A frame is one message, so `json-rpc-2.0`
// takes each frame's JSON as it comes. `@modelcontextprotocol/client` 2.4.0 ships no WebSocket transport (as of
// November 2026), so its message layer reads each frame with `deserializeMessage()`, which checks it against MCP's
// strict JSON-RPC schema. Its `ReadBuffer` is stdio framing and waits for a newline a frame does not carry, so it is
// not used here.
import assert from "node:assert/strict";
import { deserializeMessage, type JSONRPCMessage } from "@modelcontextprotocol/client";
import { isJSONRPCResponse, JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { describe, test } from "vitest";
import { approvalSetup, callTool, reply, until } from "./server-helpers.js";
import { initParams, wsRun } from "./websocket-helpers.js";

interface ApprovalParams {
  readonly request: { readonly id: string };
}

const allow = (params: ApprovalParams) => ({
  resolutions: [{ requestId: params.request.id, decision: "allow", by: "ada" }],
});

const REFUND = [{ content: [callTool("c1", "refund", { id: "o1" })] }, reply("Refunded.")];
const turnInput = [{ type: "text", text: "refund o1" }];

describe("json-rpc-2.0 over the WebSocket transport", () => {
  test("reads every frame of a turn that asks for approval, and answers the server's request", async () => {
    const { dispatcher } = approvalSetup(REFUND);
    const run = wsRun(dispatcher);
    const invalid: unknown[] = [];
    const received: string[] = [];
    const peer = new JSONRPCServerAndClient(
      new JSONRPCServer({ errorListener: (message, data) => invalid.push([message, data]) }),
      new JSONRPCClient((request) => run.client.send(JSON.stringify(request))),
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
    run.client.addEventListener("message", (event: { data: unknown }) => {
      peer.receiveAndSend(JSON.parse(event.data as string), undefined, undefined).then(
        () => {
          handled += 1;
        },
        (error: unknown) => failures.push(error),
      );
    });

    const init = await peer.request("initialize", initParams, undefined);
    assert.equal(init.serverInfo.specVersion, "v1");
    assert.deepEqual(await peer.request("session/create", { session: "s1", cwd: "/work" }, undefined), {
      session: "s1",
      head: null,
    });
    assert.equal((await peer.request("turn/start", { session: "s1", input: turnInput }, undefined)).accepted, true);
    await assert.rejects(Promise.resolve(peer.request("nope/nothing", {}, undefined)), (error: { code?: number }) => {
      assert.equal(error.code, -32601);
      return true;
    });
    await until(() => received.filter((method) => method === "turn/settled").length === 2, "two turn/settled");
    await until(() => handled + failures.length === run.frames.length, "every frame handled");

    assert.deepEqual(failures, []);
    assert.deepEqual(invalid, []);
    assert.equal(received.filter((method) => method === "approval/request").length, 1);
    assert.ok(received.filter((method) => method === "event").length > 10);
    run.client.close(1000);
    await run.done;
  });
});

describe("the JSON-RPC layer of @modelcontextprotocol/client over the WebSocket transport", () => {
  test("reads every frame of the same turn against MCP's strict schema", async () => {
    const { dispatcher } = approvalSetup(REFUND);
    const run = wsRun(dispatcher);
    const messages: JSONRPCMessage[] = [];
    const failures: unknown[] = [];
    const send = (message: JSONRPCMessage) => run.client.send(JSON.stringify(message));
    run.client.addEventListener("message", (event: { data: unknown }) => {
      try {
        const message = deserializeMessage(event.data as string);
        messages.push(message);
        if ("method" in message && "id" in message && message.method === "approval/request") {
          send({ jsonrpc: "2.0", id: message.id, result: allow(message.params as unknown as ApprovalParams) });
        }
      } catch (error) {
        failures.push(error);
      }
    });
    const result = (id: number) =>
      messages.find((message) => !("method" in message) && "id" in message && message.id === id);
    const methods = () => messages.flatMap((message) => ("method" in message ? [message.method] : []));

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams });
    await until(() => result(1) !== undefined, "the response to 1");
    send({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/work" } });
    await until(() => result(2) !== undefined, "the response to 2");
    send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: turnInput } });
    send({ jsonrpc: "2.0", id: 4, method: "nope/nothing", params: {} });
    await until(() => methods().filter((method) => method === "turn/settled").length === 2, "two turn/settled");

    assert.deepEqual(failures, []);
    assert.equal(messages.length, run.frames.length);
    const unknown = result(4);
    assert.ok(unknown !== undefined && "error" in unknown && unknown.error.code === -32601);
    assert.equal(methods().filter((method) => method === "approval/request").length, 1);
    run.client.close(1000);
    await run.done;
  });

  test("refuses only the error for an unreadable frame, whose id JSON-RPC 2.0 requires to be null", async () => {
    const { dispatcher } = approvalSetup([]);
    const run = wsRun(dispatcher);
    run.send("not json");
    await until(() => run.frames.length === 1, "the error response");
    const [frame] = run.frames as [string];
    const parsed = JSON.parse(frame);
    assert.equal(parsed.id, null);
    assert.equal(parsed.error.code, -32700);
    assert.equal(isJSONRPCResponse(parsed), true);
    assert.throws(() => deserializeMessage(frame));
    run.client.close(1000);
    await run.done;
  });
});
