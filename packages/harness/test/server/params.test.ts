// The params check: every command method has a branch of the protocol schema, a command that breaks it is answered
// InvalidParams before any handler runs, and the answer never echoes what the client sent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SessionStore } from "@buildanagent/harness/session";
import { CLIENT_METHODS, type ClientCommand, ErrorCodes, type ServerMessage } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { checkedMethods, paramsProblem } from "../../src/server/params.js";
import { memoryBackend } from "../session/memory-backend.js";
import { approvalSetup } from "./server-helpers.js";

type CommandMethod = Extract<ClientCommand, { id: unknown }>["method"];

/** The client methods that are notifications, sent without an id, so no command branch is expected for them. */
const NOTIFICATIONS: readonly string[] = ["$/cancelRequest"];

const input = [{ type: "text", text: "hi" }];

/**
 * One params value that fits each command's branch and one that breaks it. The type names every command method, so a
 * new one fails to compile until it has a case here, and the test below fails until the schema has its branch.
 */
const CASES: Record<CommandMethod, { readonly valid: unknown; readonly invalid: unknown }> = {
  initialize: {
    valid: { clientInfo: { name: "t", version: "0" }, capabilities: [] },
    invalid: { clientInfo: { name: "t" }, capabilities: [] },
  },
  "session/create": { valid: { cwd: "/w" }, invalid: { cwd: 5 } },
  "session/open": {
    valid: { session: "s", cwd: "/w", fromSeq: 0 },
    invalid: { session: "s", cwd: "/w", fromSeq: 1.5 },
  },
  "session/list": { valid: {}, invalid: { cursor: 3 } },
  "turn/start": { valid: { session: "s", input }, invalid: { session: "s", input: "hi" } },
  "turn/steer": { valid: { session: "s", input }, invalid: { session: "s" } },
  "turn/followUp": { valid: { session: "s", input }, invalid: { session: "s", input: [{ type: "nope" }] } },
  "turn/interrupt": { valid: { session: "s", reason: "stop" }, invalid: { session: 1 } },
  "approval/list": { valid: { session: "s" }, invalid: {} },
  "session/checkout": { valid: { session: "s", entryId: "e" }, invalid: { session: "s" } },
  "session/fork": { valid: { session: "s", entryId: "e" }, invalid: { session: "s", entryId: "e", extra: true } },
};

const command = (method: string, params: unknown, id = 1) => ({ jsonrpc: "2.0", id, method, params });

/** A dispatcher whose store counts every call, and a raw connection to it that keeps each message it gets. */
function counted() {
  const backend = memoryBackend();
  const calls: string[] = [];
  const store: SessionStore = {
    append: (key, entries, options) => {
      calls.push("append");
      return backend.store.append(key, entries, options);
    },
    load: (key, options) => {
      calls.push("load");
      return backend.store.load(key, options);
    },
    list: (userId) => {
      calls.push("list");
      return backend.store.list(userId);
    },
    delete: (key) => {
      calls.push("delete");
      return backend.store.delete(key);
    },
  };
  const { dispatcher } = approvalSetup([], [], {}, { ...backend, store });
  const seen: ServerMessage[] = [];
  const connection = dispatcher.connect((message) => {
    seen.push(message);
  });
  return { dispatcher, connection, seen, calls };
}

const errorTo = (seen: readonly ServerMessage[], id: number) => {
  const found = seen.find((message) => !("method" in message) && message.id === id);
  return found !== undefined && "error" in found ? found.error : undefined;
};

describe("the params check", () => {
  test("the harness's copy of the protocol schema holds the protocol package's schema", () => {
    // Compared as values, because Biome formats the copy and leaves the protocol's generated file as it is.
    const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    assert.deepEqual(
      read("../../src/server/protocol.schema.json"),
      read("../../../protocol/schema/protocol.schema.json"),
      "copy packages/protocol/schema/protocol.schema.json to packages/harness/src/server/ and run `pnpm check --write`",
    );
  });

  test("every command method in the protocol has exactly one schema branch, and the cases cover each", () => {
    const commands = CLIENT_METHODS.filter((method) => !NOTIFICATIONS.includes(method));
    assert.deepEqual([...checkedMethods()].sort(), [...commands].sort());
    assert.deepEqual(Object.keys(CASES).sort(), [...commands].sort());
  });

  for (const [method, { valid, invalid }] of Object.entries(CASES)) {
    test(`${method}: valid params pass, and invalid ones are answered InvalidParams before any handler runs`, async () => {
      assert.equal(paramsProblem(command(method, valid)), undefined);
      assert.match(paramsProblem(command(method, invalid)) ?? "", /do not match the protocol schema/);

      const { dispatcher, connection, seen, calls } = counted();
      // Opt into every experimental method, so its gate does not answer first.
      await connection.receive(
        command("initialize", { clientInfo: { name: "t", version: "0" }, capabilities: CLIENT_METHODS }, 0) as never,
      );
      calls.length = 0;
      await connection.receive(command(method, invalid) as never);
      const error = errorTo(seen, 1);
      assert.equal(error?.code, ErrorCodes.InvalidParams);
      assert.match(error?.message ?? "", new RegExp(`^the params of ${method} do not match the protocol schema: /`));
      // No handler ran: none read or wrote the store, and only the response went out.
      assert.deepEqual(calls, []);
      assert.equal(seen.length, 2);
      // Valid params reach the handler: whatever it answers, the schema check is not what answers.
      await connection.receive(command(method, valid, 2) as never);
      assert.doesNotMatch(errorTo(seen, 2)?.message ?? "", /protocol schema/);
      connection.close();
      await dispatcher.close();
    });
  }

  test("a command without params is checked as one with empty params, as JSON-RPC allows", async () => {
    const { params: _list, ...list } = command("session/list", {});
    assert.equal(paramsProblem(list), undefined);
    const { params: _create, ...create } = command("session/create", {});
    assert.equal(
      paramsProblem(create),
      "the params of session/create do not match the protocol schema: /params/cwd fails required",
    );
    // Through the dispatcher, the handler gets an empty object and answers.
    const { dispatcher, connection, seen } = counted();
    await connection.receive(
      command("initialize", { clientInfo: { name: "t", version: "0" }, capabilities: [] }, 0) as never,
    );
    await connection.receive(list as never);
    const answer = seen.find((message) => !("method" in message) && message.id === 1);
    assert.ok(answer !== undefined && "result" in answer, JSON.stringify(answer));
    connection.close();
    await dispatcher.close();
  });

  test("only the params are checked: a member outside them is left to the envelope check", () => {
    const extra = { ...command("session/list", {}), extra: true };
    assert.equal(paramsProblem(extra), undefined);
    assert.equal(paramsProblem({ jsonrpc: "1.0", id: 1, method: "session/list", params: {} } as never), undefined);
  });

  test("the answer names the field and the keyword, never the value or a key the client chose", () => {
    const value = "a-value-the-client-sent";
    const problem = paramsProblem(command("session/create", { cwd: [value] })) ?? "";
    assert.equal(problem, "the params of session/create do not match the protocol schema: /params/cwd fails type");
    const long = "k".repeat(10_000);
    const cut = paramsProblem(command("session/create", { cwd: "/w", [long]: value })) ?? "";
    assert.equal(
      cut,
      "the params of session/create do not match the protocol schema: /params fails additionalProperties",
    );
    const key = "evil\nstdio: forged log line";
    const nested = paramsProblem(
      command("turn/start", { session: "s", input: [{ type: "text", text: "hi", [key]: value }] }),
    );
    assert.ok(nested !== undefined);
    assert.ok(!nested.includes("\n") && !nested.includes("evil") && !nested.includes("forged"), nested);
    assert.match(nested, /: \/params\/input\/0 fails /);
  });

  test("an experimental method a client has not opted into answers NotOptedIn, whatever its params", async () => {
    const { dispatcher, connection, seen } = counted();
    await connection.receive(command("session/fork", { session: 3 }) as never);
    assert.equal(errorTo(seen, 1)?.code, ErrorCodes.NotOptedIn);
    connection.close();
    await dispatcher.close();
  });

  test("a method with no branch is left to the dispatcher, which answers MethodNotFound", () => {
    assert.equal(paramsProblem({ method: "session/nope" }), undefined);
  });
});
