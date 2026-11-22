/**
 * `@buildanagent/agent-safety/stores/dynamodb`: the effect store and the plan ledger on DynamoDB, through an
 * `@aws-sdk/client-dynamodb` client. Every change is a conditional write, so DynamoDB decides a race: `begin` is a put
 * that needs the key to be absent, `takeOver` a put that needs the stored attempt to be the one before, and `settle` a
 * put that needs the record to be `started` at this attempt. A plan's step claim is one transaction that checks the
 * step before it and puts this one.
 *
 * Reads are consistent reads. The table needs one string partition key named `pk` and no sort key.
 */
import {
  ConditionalCheckFailedException,
  type DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import type { EffectClaim, EffectRecord, EffectStore } from "../effect-store.js";
import type { PlanLedger } from "../plan-approval.js";

/** The options of the DynamoDB stores. */
export interface DynamoStoreOptions {
  /** The table that holds the records and the plan steps. */
  readonly tableName: string;
}

const effectPk = (key: string) => `effect#${key}`;
const stepPk = (planId: string, stepIndex: number) => `plan#${planId}#${stepIndex}`;

function item(record: EffectRecord) {
  return {
    pk: { S: effectPk(record.key) },
    attempt: { N: String(record.attempt) },
    state: { S: record.state },
    record: { S: JSON.stringify(record) },
  };
}

/** Whether an SDK error is the answer "the condition was false", which is an expected result and not a failure. */
function conditionFailed(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException || error instanceof TransactionCanceledException;
}

/** An `EffectStore` on DynamoDB. */
export function dynamoEffectStore(client: DynamoDBClient, options: DynamoStoreOptions): EffectStore {
  const { tableName } = options;
  const read = async (key: string): Promise<EffectRecord | undefined> => {
    const { Item } = await client.send(
      new GetItemCommand({ TableName: tableName, Key: { pk: { S: effectPk(key) } }, ConsistentRead: true }),
    );
    return Item?.record?.S === undefined ? undefined : (JSON.parse(Item.record.S) as EffectRecord);
  };
  const lost = async (key: string): Promise<EffectClaim> => {
    const existing = await read(key);
    if (existing === undefined) throw new Error(`the effect record ${key} changed while it was being claimed`);
    return { existing };
  };
  /** A put that needs `condition`, answering whether it was true. */
  const put = async (
    record: EffectRecord,
    condition: string,
    values?: Record<string, { S: string } | { N: string }>,
  ): Promise<boolean> => {
    try {
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: item(record),
          ConditionExpression: condition,
          ExpressionAttributeNames: { "#pk": "pk", "#attempt": "attempt", "#state": "state" },
          ...(values === undefined ? {} : { ExpressionAttributeValues: values }),
        }),
      );
      return true;
    } catch (error) {
      if (conditionFailed(error)) return false;
      throw error;
    }
  };
  return {
    async begin(record) {
      return (await put(record, "attribute_not_exists(#pk)")) ? "started" : lost(record.key);
    },
    async takeOver(record) {
      const previous = { ":previous": { N: String(record.attempt - 1) } };
      const won = await put(record, "attribute_not_exists(#pk) OR #attempt = :previous", previous);
      return won ? "started" : lost(record.key);
    },
    async settle(record) {
      return put(record, "#state = :started AND #attempt = :attempt", {
        ":started": { S: "started" },
        ":attempt": { N: String(record.attempt) },
      });
    },
    get: read,
  };
}

/**
 * A `PlanLedger` on DynamoDB. Step `n` is an item that exists once the step passed. A claim of step `n` is one
 * transaction: put the item for `n` if it is absent, and check that the item for `n - 1` exists. When the transaction
 * is refused, a read of the item for `n` tells `replayed` from `out_of_order`.
 */
export function dynamoPlanLedger(client: DynamoDBClient, options: DynamoStoreOptions): PlanLedger {
  const { tableName } = options;
  const exists = async (planId: string, stepIndex: number): Promise<boolean> => {
    const { Item } = await client.send(
      new GetItemCommand({ TableName: tableName, Key: { pk: { S: stepPk(planId, stepIndex) } }, ConsistentRead: true }),
    );
    return Item !== undefined;
  };
  return Object.freeze({
    async claim(planId: string, stepIndex: number) {
      const put = {
        Put: {
          TableName: tableName,
          Item: { pk: { S: stepPk(planId, stepIndex) } },
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": "pk" },
        },
      };
      const earlier =
        stepIndex === 0
          ? []
          : [
              {
                ConditionCheck: {
                  TableName: tableName,
                  Key: { pk: { S: stepPk(planId, stepIndex - 1) } },
                  ConditionExpression: "attribute_exists(#pk)",
                  ExpressionAttributeNames: { "#pk": "pk" },
                },
              },
            ];
      try {
        await client.send(new TransactWriteItemsCommand({ TransactItems: [...earlier, put] }));
        return "claimed" as const;
      } catch (error) {
        if (!conditionFailed(error)) throw error;
        return (await exists(planId, stepIndex)) ? ("replayed" as const) : ("out_of_order" as const);
      }
    },
  });
}
