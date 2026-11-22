import assert from "node:assert/strict";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
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
// conditions, so each is pinned in full. A request carries only the names and values its expression uses, which the
// fake enforces as DynamoDB does, and a token that names the call and the SDK's retries of it.
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

type Body = Record<string, unknown>;

/** A request body with the call's random token replaced by a marker, after checking that it is one. */
function withoutToken(body: Body | undefined): Body {
  const written = body?.Item as { token?: { S?: string } } | undefined;
  assert.match(written?.token?.S ?? "", /^[0-9a-f-]{36}$/, "the item names the call that wrote it");
  return { ...body, Item: { ...written, token: { S: "<token>" } } };
}

test("dynamodb: begin sends a put that needs the key to be absent, and asks for the old item on a failure", async () => {
  const store = freshStore();
  await store.begin(RECORD);
  assert.deepEqual(
    dynamo.requests.map((request) => request.operation),
    ["PutItem"],
  );
  assert.deepEqual(withoutToken(dynamo.requests[0]?.body), {
    TableName: TABLE,
    Item: {
      pk: { S: "effect#k1" },
      attempt: { N: "1" },
      state: { S: "started" },
      record: { S: JSON.stringify(RECORD) },
      token: { S: "<token>" },
    },
    ConditionExpression: "attribute_not_exists(#pk)",
    ExpressionAttributeNames: { "#pk": "pk" },
    ReturnValuesOnConditionCheckFailure: "ALL_OLD",
  });
});

test("dynamodb: takeOver needs the stored attempt to be the one before, and settle needs a started record", async () => {
  const store = freshStore();
  await store.begin(RECORD);
  dynamo.requests.length = 0;
  await store.takeOver({ ...RECORD, attempt: 2 });
  await store.settle({ ...RECORD, attempt: 2, state: "settled" });
  const [takeOver, settle] = dynamo.requests.map((request) => request.body);
  assert.equal(takeOver?.ConditionExpression, "attribute_not_exists(#pk) OR #attempt = :previous");
  assert.deepEqual(takeOver?.ExpressionAttributeNames, { "#pk": "pk", "#attempt": "attempt" });
  assert.deepEqual(takeOver?.ExpressionAttributeValues, { ":previous": { N: "1" } });
  assert.equal(settle?.ConditionExpression, "#state = :started AND #attempt = :attempt");
  assert.deepEqual(settle?.ExpressionAttributeNames, { "#state": "state", "#attempt": "attempt" });
  assert.deepEqual(settle?.ExpressionAttributeValues, { ":started": { S: "started" }, ":attempt": { N: "2" } });
});

test("dynamodb: a plan claim is one transaction that checks the step before and puts this one, under a request token", async () => {
  const ledger = freshLedger();
  await ledger.claim("plan-1", 0);
  await ledger.claim("plan-1", 1);
  const [first, second] = dynamo.requests.map((request) => request.body);
  for (const body of [first, second]) assert.match(String(body?.ClientRequestToken), /^[0-9a-f-]{36}$/);
  assert.notEqual(first?.ClientRequestToken, second?.ClientRequestToken, "each claim has a token of its own");
  assert.deepEqual(first?.TransactItems, [
    {
      Put: {
        TableName: TABLE,
        Item: { pk: { S: "plan#plan-1#0" } },
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": "pk" },
      },
    },
  ]);
  assert.deepEqual(second?.TransactItems, [
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

test("the fake rejects a request that carries a name or value its expression doesn't use, as DynamoDB does", async () => {
  const store = freshStore();
  const rejected = [
    { ConditionExpression: "attribute_not_exists(#pk)", ExpressionAttributeNames: { "#pk": "pk", "#state": "state" } },
    { ConditionExpression: "#state = :v", ExpressionAttributeNames: { "#state": "state" } },
    {
      ConditionExpression: "attribute_not_exists(#pk)",
      ExpressionAttributeNames: { "#pk": "pk" },
      ExpressionAttributeValues: { ":extra": { S: "x" } },
    },
  ];
  for (const extra of rejected) {
    await assert.rejects(
      dynamo.client.send(new PutItemCommand({ TableName: TABLE, Item: { pk: { S: "effect#x" } }, ...extra } as never)),
      (error: Error) => error.name === "ValidationException",
      JSON.stringify(extra),
    );
  }
  assert.equal(dynamo.items.size, 0);
  assert.ok(store);
});

test("dynamodb: a put whose response was lost and then retried by the SDK counts as the caller's own", async () => {
  const store = freshStore();
  dynamo.loseNextResponse("PutItem");
  assert.equal(
    await store.begin(RECORD),
    "started",
    "the retry failed its own condition, and the store knows the write",
  );
  assert.equal(
    dynamo.requests.filter((request) => request.operation === "PutItem").length,
    2,
    "the SDK retried the put",
  );
  // Another caller's identical record is not the caller's own: it has its own token.
  const other = await store.begin(RECORD);
  assert.notEqual(other, "started");

  dynamo.loseNextResponse("PutItem");
  assert.equal(await store.takeOver({ ...RECORD, attempt: 2 }), "started");
  dynamo.loseNextResponse("PutItem");
  assert.equal(await store.settle({ ...RECORD, attempt: 2, state: "settled" }), true);
  assert.equal((await store.get("k1"))?.state, "settled");
});

test("dynamodb: a claim whose response was lost and then retried is claimed once, and later claims see a replay", async () => {
  const ledger = freshLedger();
  dynamo.loseNextResponse("TransactWriteItems");
  assert.equal(await ledger.claim("plan-1", 0), "claimed", "the retry carried the same token, so it is the same claim");
  assert.equal(await ledger.claim("plan-1", 0), "replayed", "a new call for the step is a replay");
  assert.equal(await ledger.claim("plan-1", 1), "claimed");
});

test("dynamodb: a transaction cancelled for a reason other than a false condition is rethrown, not read as out_of_order", async () => {
  for (const code of ["TransactionConflict", "ThrottlingError", "ProvisionedThroughputExceeded"]) {
    const ledger = freshLedger();
    dynamo.cancelNextTransaction(code);
    await assert.rejects(
      ledger.claim("plan-1", 0),
      (error: Error) => error.name === "TransactionCanceledException",
      code,
    );
    assert.equal(await ledger.claim("plan-1", 0), "claimed", `after ${code} the step was not used up`);
  }
});

test("dynamodb: errors are recognised by name, so a second copy of the SDK's error classes still works", async () => {
  const copy = (name: string, extra: object = {}) => Object.assign(new Error(name), { name, ...extra });
  const conditionFalse = dynamoEffectStore(
    { send: async () => Promise.reject(copy("ConditionalCheckFailedException")) } as never,
    { tableName: TABLE },
  );
  assert.equal(await conditionFalse.settle({ ...RECORD, state: "settled" }), false);
  const refused = dynamoPlanLedger(
    {
      send: async (command: { constructor: { name: string } }) =>
        command.constructor.name === "GetItemCommand"
          ? {}
          : Promise.reject(
              copy("TransactionCanceledException", { CancellationReasons: [{ Code: "ConditionalCheckFailed" }] }),
            ),
    } as never,
    { tableName: TABLE },
  );
  assert.equal(await refused.claim("plan-1", 3), "out_of_order");
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
