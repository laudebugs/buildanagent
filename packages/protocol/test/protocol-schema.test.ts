// The JSON Schema of the protocol's messages: the committed file is what the generator writes now, every fixture
// validates against it, the messages a reader must reject do not, and its method names are the constants'.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLIENT_METHODS,
  EXPERIMENTAL_METHODS,
  SERVER_NOTIFICATION_METHODS,
  SERVER_REQUEST_METHODS,
  SESSION_ENTRY_TYPES,
} from "@buildanagent/protocol";
import { AGENT_EVENT_TYPES } from "@buildanagent/sdk";
import { Validator } from "@cfworker/json-schema";
import { test } from "vitest";
import { AGENT_EVENT_TYPE_NAMES, buildProtocolSchema } from "../scripts/protocol-schema.js";
import { COMMANDS, MESSAGES, NOTIFICATIONS, SERVER_REQUESTS } from "./protocol-fixtures.js";

const committed = readFileSync(new URL("../schema/protocol.schema.json", import.meta.url), "utf8");
const validator = new Validator(JSON.parse(committed), "2020-12");

test("the committed schema is what the generator writes now", () => {
  assert.equal(
    committed,
    `${JSON.stringify(buildProtocolSchema(), null, 2)}\n`,
    "run `pnpm --filter @buildanagent/protocol schema`",
  );
});

test("every fixture validates against the committed schema", () => {
  for (const message of MESSAGES) {
    const result = validator.validate(message);
    assert.equal(
      result.valid,
      true,
      `${JSON.stringify(message).slice(0, 120)}: ${JSON.stringify(result.errors).slice(0, 300)}`,
    );
  }
});

test("a message without jsonrpc, with another version, an unknown method or a stray param fails validation", () => {
  const start = COMMANDS.find((command) => "method" in command && command.method === "turn/start");
  assert.ok(start && "params" in start);
  const { jsonrpc: _removed, ...noVersion } = start;
  const invalid: unknown[] = [
    noVersion,
    { ...start, jsonrpc: "1.0" },
    { ...start, method: "turn/begin" },
    { ...start, params: { ...start.params, extra: true } },
    { ...start, params: { session: "s1" } },
    { ...start, id: {} },
    { ...start, params: { session: "s1", input: [{ type: "video" }] } },
    { jsonrpc: "2.0", id: 1, method: "session/list", params: { cursor: 3 } },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: 1, result: {}, error: { code: 1, message: "x" } },
    {
      jsonrpc: "2.0",
      method: "turn/settled",
      params: { session: "s", turn: "t", result: { stopReason: "finished", steps: 1, costUsd: null } },
    },
    {
      jsonrpc: "2.0",
      method: "event",
      params: {
        session: "s",
        seq: 0,
        event: { type: "not_an_event", runId: "r", seq: 0, stepIndex: 0, timestamp: "t" },
      },
    },
    { jsonrpc: "2.0", id: 1, method: "approval/request", params: { session: "s", request: { id: "r" } } },
  ];
  for (const input of invalid) assert.equal(validator.validate(input).valid, false, JSON.stringify(input));
});

/** The method names a schema branch pins, found by walking the schema. */
function methodNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const item of node) methodNames(item, found);
  else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    const method = (record.properties as { method?: { const?: string; enum?: string[] } } | undefined)?.method;
    if (method?.const !== undefined) found.add(method.const);
    for (const name of method?.enum ?? []) found.add(name);
    for (const value of Object.values(record)) methodNames(value, found);
  }
  return found;
}

test("the schema names exactly the methods the constants list", () => {
  const expected = [...CLIENT_METHODS, ...SERVER_REQUEST_METHODS, ...SERVER_NOTIFICATION_METHODS].sort();
  assert.deepEqual([...methodNames(JSON.parse(committed))].sort(), expected);
  assert.equal(CLIENT_METHODS.length, 12, "eleven client methods and the cancel notification");
  assert.ok(EXPERIMENTAL_METHODS.every((method) => CLIENT_METHODS.includes(method)));
});

test("the fixtures cover every method, and each experimental method is a client method", () => {
  const used = new Set(
    [...COMMANDS, ...SERVER_REQUESTS, ...NOTIFICATIONS].map((message) => ("method" in message ? message.method : "")),
  );
  for (const method of [...CLIENT_METHODS, ...SERVER_REQUEST_METHODS, ...SERVER_NOTIFICATION_METHODS]) {
    assert.ok(used.has(method), `no fixture for ${method}`);
  }
  for (const method of EXPERIMENTAL_METHODS)
    assert.ok(CLIENT_METHODS.includes(method), `${method} is not a client method`);
});

test("the schema's SDK event types are the SDK's own", () => {
  assert.deepEqual([...AGENT_EVENT_TYPE_NAMES].sort(), [...AGENT_EVENT_TYPES].sort());
});

const isEntryType = (type: unknown): boolean => SESSION_ENTRY_TYPES.includes(type as never);

/** Every property name a schema lists, and every key a value uses, so an optional field only one side has shows up. */
function schemaProperties(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const item of node) schemaProperties(item, found);
  else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    const properties = record.properties as Record<string, unknown> | undefined;
    // A session entry's own fields are covered by the entry schema's test, not repeated here.
    if (isEntryType((properties?.type as { const?: string } | undefined)?.const)) return found;
    for (const name of Object.keys(properties ?? {})) found.add(name);
    for (const value of Object.values(record)) schemaProperties(value, found);
  }
  return found;
}

function usedKeys(value: unknown, found = new Set<string>(), skip = false): Set<string> {
  if (Array.isArray(value)) for (const item of value) usedKeys(item, found, skip);
  else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const isEntry = isEntryType(record.type) && "parentId" in record;
    if (!isEntry && !skip) for (const key of Object.keys(record)) found.add(key);
    for (const child of Object.values(record)) usedKeys(child, found, skip || isEntry);
  }
  return found;
}

test("every property the schema lists, optional ones included, is used by a fixture, and no fixture uses one it lacks", () => {
  const listed = schemaProperties(JSON.parse(committed));
  const used = usedKeys(MESSAGES);
  // Outside the schema by design: the SDK's event fields beyond its base fields, which the loose mirror lets through, and
  // the contents of a tool's free-form input.
  const sdkEventFields = new Set(["index", "delta", "path"]);
  // The token counts a `usage` entry holds. Two entry fields share the shape, so the schema names it once in `$defs`,
  // and no message fixture reaches it outside an entry, whose own fields the entry schema's test covers.
  const usageShapeFields = new Set([
    "uncachedInput",
    "cacheRead",
    "cacheWrite",
    "5m",
    "1h",
    "output",
    "reasoning",
    "raw",
    "unreported",
  ]);
  assert.deepEqual(
    [...listed].filter((name) => !used.has(name) && !usageShapeFields.has(name)).sort(),
    [],
    "a field no fixture uses",
  );
  assert.deepEqual(
    [...used].filter((name) => !listed.has(name) && !sdkEventFields.has(name)).sort(),
    [],
    "a field the schema lacks",
  );
});

test("the schema's shared shapes have names that don't depend on the order they were found in", () => {
  const defs = Object.keys((JSON.parse(committed) as { $defs: Record<string, unknown> }).$defs);
  assert.ok(defs.length > 0);
  for (const name of defs) assert.doesNotMatch(name, /^__schema\d+$/, name);
  for (const name of ["Id", "ContentBlock", "SessionEntry", "SignedPendingRequest", "Resolution", "RpcError"]) {
    assert.ok(defs.includes(name), `${name} is a named shape`);
  }
});
