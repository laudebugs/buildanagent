// What the DynamoDB store does beyond the shared suite: batches past DynamoDB's request limits, the commit race, a
// crash between staging and commit, a lost response, unprocessed writes, a second process's commits and the exact
// requests it sends.
import assert from "node:assert/strict";
import { type DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { dynamoStore, MAX_DYNAMO_ENTRY_BYTES } from "@buildanagent/harness/aws/dynamodb";
import { ConflictError, type EntryInput, type SessionStore } from "@buildanagent/harness/session";
import { beforeEach, describe, test } from "vitest";
import { TABLE } from "./aws-target.js";
import { fakeDynamoDb } from "./fake-dynamodb.js";

const KEY = { userId: "ada", sessionId: "s1" };

const header = (): EntryInput => ({
  id: "h1",
  parentId: null,
  timestamp: "2026-11-24T00:00:00.000Z",
  origin: "harness",
  type: "session_header",
  formatVersion: 1,
  harnessVersion: "0.0.0",
  sdkVersion: "0.0.0",
  defaultsHash: "d",
  capabilities: [],
  ablationHash: "a",
});

const record = (id: string, parentId: string): EntryInput => ({
  id,
  parentId,
  timestamp: "2026-11-24T00:00:01.000Z",
  origin: "harness",
  type: "product_record",
  name: "test.record",
  data: { id },
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of source) found.push(item);
  return found;
}

const ids = async (store: SessionStore, key = KEY) => (await collect(store.load(key))).map((entry) => entry.id);

/** A client whose next head commit first lets `before()` run, as another process that commits in between would. */
function racing(client: DynamoDBClient, before: () => Promise<unknown>): DynamoDBClient {
  let armed = true;
  return {
    async send(command: { input: { Item?: { sk?: { S?: string } } } }) {
      if (armed && command instanceof PutItemCommand && command.input.Item?.sk?.S?.startsWith("h#")) {
        armed = false;
        await before();
      }
      return client.send(command as never);
    },
  } as unknown as DynamoDBClient;
}

const entryItems = (dynamo: ReturnType<typeof fakeDynamoDb>) =>
  dynamo.items(TABLE).filter((item) => item.sk?.S?.startsWith("e#"));

describe("dynamoStore", () => {
  let dynamo: ReturnType<typeof fakeDynamoDb>;
  beforeEach(() => {
    dynamo = fakeDynamoDb();
  });

  test("a batch larger than one batch write and one query page is written whole and loads in order", async () => {
    const store = dynamoStore(dynamo.client, { tableName: TABLE });
    const batch = [header(), ...Array.from({ length: 149 }, (_, i) => record(`r${i}`, i === 0 ? "h1" : `r${i - 1}`))];
    const written = await store.append(KEY, batch, { expectedLastId: null });
    assert.equal(written.at(-1)?.seq, 149);
    assert.deepEqual(
      await ids(store),
      batch.map((entry) => entry.id),
    );
    assert.equal(dynamo.sent.filter((op) => op === "BatchWriteItem").length, 6, "150 items go in six batches of 25");
    assert.ok(dynamo.sent.filter((op) => op === "Query").length > 1, "the load read more than one page");
  });

  test("a writer that loses the commit race reads the log again and appends after the winner", async () => {
    const winner = dynamoStore(dynamo.client, { tableName: TABLE });
    await winner.append(KEY, [header()]);
    const loser = dynamoStore(
      racing(dynamo.client, () => winner.append(KEY, [record("w1", "h1")])),
      {
        tableName: TABLE,
      },
    );
    await loser.append(KEY, [record("l1", "h1")]);
    assert.deepEqual(await ids(winner), ["h1", "w1", "l1"]);
    assert.equal(entryItems(dynamo).length, 3, "the losing attempt deleted the items it had staged");
  });

  test("a loser whose expected tail went stale throws a ConflictError and leaves no items behind", async () => {
    const winner = dynamoStore(dynamo.client, { tableName: TABLE });
    await winner.append(KEY, [header()]);
    const loser = dynamoStore(
      racing(dynamo.client, () => winner.append(KEY, [record("w1", "h1")])),
      {
        tableName: TABLE,
      },
    );
    await assert.rejects(
      () => loser.append(KEY, [record("l1", "h1")], { expectedLastId: "h1" }),
      (error) => error instanceof ConflictError,
    );
    assert.deepEqual(await ids(winner), ["h1", "w1"]);
    assert.equal(entryItems(dynamo).length, 2);
  });

  test("items staged by a writer that died before its commit are never read as the log", async () => {
    const store = dynamoStore(dynamo.client, { tableName: TABLE });
    await store.append(KEY, [header()]);
    const dying = dynamoStore(
      racing(dynamo.client, () => Promise.reject(new Error("the process died before its commit"))),
      { tableName: TABLE },
    );
    await assert.rejects(() => dying.append(KEY, [record("lost", "h1")]), /died before its commit/);
    assert.equal(entryItems(dynamo).length, 2, "the dead writer's item is still in the table");
    await store.append(KEY, [record("r1", "h1")], { expectedLastId: "h1" });
    assert.deepEqual(await ids(store), ["h1", "r1"], "the log skips the orphan that holds the same sequence number");
    assert.deepEqual(await ids(dynamoStore(dynamo.client, { tableName: TABLE })), ["h1", "r1"]);
  });

  test("a commit whose response was lost is recognised as this append's own when the SDK resends it", async () => {
    const store = dynamoStore(dynamo.client, { tableName: TABLE });
    await store.append(KEY, [header()]);
    dynamo.loseNextResponse("PutItem");
    const written = await store.append(KEY, [record("r1", "h1")], { expectedLastId: "h1" });
    assert.equal(written[0]?.seq, 1);
    assert.deepEqual(await ids(store), ["h1", "r1"]);
  });

  test("writes DynamoDB leaves unprocessed are sent again until every one is stored", async () => {
    const store = dynamoStore(dynamo.client, { tableName: TABLE });
    dynamo.leaveUnprocessed(2);
    await store.append(KEY, [header(), record("r1", "h1"), record("r2", "r1")]);
    assert.deepEqual(await ids(store), ["h1", "r1", "r2"]);
    assert.equal(dynamo.sent.filter((op) => op === "BatchWriteItem").length, 3);
  });

  test("a second process sees the first one's commits, a delete and a session made again under the same key", async () => {
    const first = dynamoStore(dynamo.client, { tableName: TABLE });
    const second = dynamoStore(dynamo.client, { tableName: TABLE });
    await first.append(KEY, [header(), record("r1", "h1")]);
    await second.append(KEY, [record("r2", "r1")], { expectedLastId: "r1" });
    await first.append(KEY, [record("r3", "r2")], { expectedLastId: "r2" });
    assert.deepEqual(await ids(second), ["h1", "r1", "r2", "r3"]);
    await second.delete(KEY);
    assert.deepEqual(dynamo.items(TABLE), [], "delete removed the head and every entry item");
    await second.append(KEY, [{ ...header(), id: "h2" }, record("n1", "h2")]);
    await assert.rejects(
      () => first.append(KEY, [record("x", "r3")], { expectedLastId: "r3" }),
      (error) => error instanceof ConflictError,
      "the first process's cached log is gone, so its old tail conflicts",
    );
    await first.append(KEY, [record("n2", "n1")], { expectedLastId: "n1" });
    assert.deepEqual(await ids(first), ["h2", "n1", "n2"]);
    const [summary] = await collect(first.list("ada"));
    assert.equal(summary?.entryCount, 3);
    assert.equal(summary?.sessionId, "s1");
  });

  test("a head that names a batch whose items are missing is a session_corrupt error", async () => {
    const store = dynamoStore(dynamo.client, { tableName: TABLE });
    await store.append(KEY, [header(), record("r1", "h1")]);
    const head = dynamo.items(TABLE).find((item) => item.sk?.S === "h#s1");
    dynamo.put(TABLE, { ...head, batch: { S: "a-batch-no-item-has" } } as never);
    await assert.rejects(() => ids(store), { code: "session_corrupt" });
  });

  test("loadRaw returns the entries as they were written", async () => {
    const store = dynamoStore(dynamo.client, { tableName: TABLE });
    await store.append(KEY, [header(), record("r1", "h1")]);
    assert.ok(store.loadRaw !== undefined, "the store offers loadRaw, so a migration can read an old format");
    const raw = await collect(store.loadRaw(KEY));
    assert.deepEqual(
      raw.map((entry) => (entry as { id: string }).id),
      ["h1", "r1"],
    );
  });

  test("the commit is one put of the head, on the condition that it is absent or names the batch the append read", async () => {
    const store = dynamoStore(dynamo.client, { tableName: TABLE });
    const sent: { ConditionExpression?: string; ExpressionAttributeValues?: unknown }[] = [];
    const recording = {
      send: (command: { input: (typeof sent)[number] & { Item?: { sk?: { S?: string } } } }) => {
        if (command instanceof PutItemCommand && command.input.Item?.sk?.S === "h#s1") sent.push(command.input);
        return dynamo.client.send(command as never);
      },
    } as unknown as DynamoDBClient;
    const recorded = dynamoStore(recording, { tableName: TABLE });
    await recorded.append(KEY, [header()]);
    await recorded.append(KEY, [record("r1", "h1")]);
    assert.equal(sent[0]?.ConditionExpression, "attribute_not_exists(#sk)");
    assert.equal(sent[1]?.ConditionExpression, "#batch = :batch");
    const firstBatch = entryItems(dynamo)[0]?.batch?.S;
    assert.deepEqual(sent[1]?.ExpressionAttributeValues, { ":batch": { S: firstBatch } });
    assert.deepEqual(await ids(store), ["h1", "r1"]);
    const keys = dynamo
      .items(TABLE)
      .map((item) => `${item.pk?.S} ${item.sk?.S?.replace(/#[0-9a-f-]{36}$/, "#<batch>")}`);
    assert.deepEqual(keys, ["u#ada e#s1#000000000000#<batch>", "u#ada e#s1#000000000001#<batch>", "u#ada h#s1"]);
  });

  test("refuses a missing client, a table name DynamoDB would refuse and an entry bound over the item limit", () => {
    const code = { code: "invalid_aws_options" };
    assert.throws(() => dynamoStore(undefined as never, { tableName: TABLE }), code);
    assert.throws(() => dynamoStore(dynamo.client, { tableName: "x" }), code);
    assert.throws(
      () => dynamoStore(dynamo.client, { tableName: TABLE, maxEntryBytes: MAX_DYNAMO_ENTRY_BYTES + 1 }),
      code,
    );
    dynamoStore(dynamo.client, { tableName: TABLE, maxEntryBytes: MAX_DYNAMO_ENTRY_BYTES });
  });
});
