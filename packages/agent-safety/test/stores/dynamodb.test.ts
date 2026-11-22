import assert from "node:assert/strict";
import { dynamoEffectStore, dynamoPlanLedger } from "@buildanagent/agent-safety/stores/dynamodb";
import { effectStoreConformance, planLedgerConformance } from "@buildanagent/agent-safety/testing";
import { test } from "vitest";
import { fakeDynamoDb } from "./fake-dynamodb.js";
import { leaseScenario } from "./scenario.js";

const TABLE = "safety";
const dynamo = fakeDynamoDb();

/** A store on an empty fake table, so each case starts from nothing. */
function freshStore() {
  dynamo.reset();
  return dynamoEffectStore(dynamo.client, { tableName: TABLE });
}

function freshLedger() {
  dynamo.reset();
  return dynamoPlanLedger(dynamo.client, { tableName: TABLE });
}

for (const conformance of effectStoreConformance()) {
  test(`dynamodb effect store: ${conformance.name}`, () => conformance.run(freshStore));
}

for (const conformance of planLedgerConformance()) {
  test(`dynamodb plan ledger: ${conformance.name}`, () => conformance.run(freshLedger));
}

test("dynamodb: a started record is taken over only after its lease lapses", () => leaseScenario(freshStore));

// What the stores send, as the AWS SDK puts it on the wire. A change to these requests is a change to the stores'
// conditions, so each is pinned in full.
const RECORD = {
  key: "k1",
  scope: { tenant: "t", session: "s", branch: "main", toolCallId: "c" },
  operation: "refund_create",
  inputHash: "a".repeat(64),
  attempt: 1,
  state: "started" as const,
  startedAt: "2026-11-22T10:00:00.000Z",
  leaseUntil: "2026-11-22T10:05:00.000Z",
};

test("dynamodb: begin sends a put that needs the key to be absent", async () => {
  const store = freshStore();
  await store.begin(RECORD);
  assert.deepEqual(dynamo.requests, [
    {
      operation: "PutItem",
      body: {
        TableName: TABLE,
        Item: {
          pk: { S: "effect#k1" },
          attempt: { N: "1" },
          state: { S: "started" },
          record: { S: JSON.stringify(RECORD) },
        },
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk", "#attempt": "attempt", "#state": "state" },
      },
    },
  ]);
});

test("dynamodb: takeOver needs the stored attempt to be the one before, and settle needs a started record", async () => {
  const store = freshStore();
  await store.begin(RECORD);
  dynamo.requests.length = 0;
  await store.takeOver({ ...RECORD, attempt: 2 });
  await store.settle({ ...RECORD, attempt: 2, state: "settled" });
  const [takeOver, settle] = dynamo.requests.map((request) => request.body);
  assert.equal(takeOver?.ConditionExpression, "attribute_not_exists(#pk) OR #attempt = :previous");
  assert.deepEqual(takeOver?.ExpressionAttributeValues, { ":previous": { N: "1" } });
  assert.equal(settle?.ConditionExpression, "#state = :started AND #attempt = :attempt");
  assert.deepEqual(settle?.ExpressionAttributeValues, { ":started": { S: "started" }, ":attempt": { N: "2" } });
});

test("dynamodb: a plan claim is one transaction that checks the step before and puts this one", async () => {
  const ledger = freshLedger();
  await ledger.claim("plan-1", 0);
  await ledger.claim("plan-1", 1);
  const [first, second] = dynamo.requests.map((request) => request.body.TransactItems);
  assert.deepEqual(first, [
    {
      Put: {
        TableName: TABLE,
        Item: { pk: { S: "plan#plan-1#0" } },
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk" },
      },
    },
  ]);
  assert.deepEqual(second, [
    {
      ConditionCheck: {
        TableName: TABLE,
        Key: { pk: { S: "plan#plan-1#0" } },
        ConditionExpression: "attribute_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk" },
      },
    },
    {
      Put: {
        TableName: TABLE,
        Item: { pk: { S: "plan#plan-1#1" } },
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk" },
      },
    },
  ]);
});

test("dynamodb: every read is a consistent read, and an error that is not a false condition is rethrown", async () => {
  const store = freshStore();
  await store.get("k1");
  assert.equal(dynamo.requests[0]?.body.ConsistentRead, true);
  const broken = dynamoEffectStore({ send: async () => Promise.reject(new Error("throttled")) } as never, {
    tableName: TABLE,
  });
  await assert.rejects(broken.begin(RECORD), /throttled/);
  await assert.rejects(broken.settle({ ...RECORD, state: "settled" }), /throttled/);
});
