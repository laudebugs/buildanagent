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
  type DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import type { EffectClaim, EffectRecord, EffectStore } from "../effect-store.js";
import type { PlanLedger } from "../plan-approval.js";
import { assertStepIndex } from "../plan-ledger.js";
import { lostClaim } from "./lost-claim.js";

/** The options of the DynamoDB stores. */
export interface DynamoStoreOptions {
  /** The table that holds the records and the plan steps. */
  readonly tableName: string;
}

const effectPk = (key: string) => `effect#${key}`;
const stepPk = (planId: string, stepIndex: number) => `plan#${planId}#${stepIndex}`;

type Attributes = Record<string, { S: string } | { N: string }>;

/** The item for a record. `token` names the call that wrote it, so that call can tell its own retried write apart. */
function item(record: EffectRecord, token: string) {
  return {
    pk: { S: effectPk(record.key) },
    attempt: { N: String(record.attempt) },
    state: { S: record.state },
    record: { S: JSON.stringify(record) },
    token: { S: token },
  };
}

// The parts of an SDK error these stores read. They compare an error's `name`, not its class, so a host that loads
// its own copy of the SDK next to this package's still gets its errors recognised.
interface SdkErrorLike {
  readonly name?: string;
  readonly Item?: { readonly token?: { readonly S?: string } };
  readonly CancellationReasons?: readonly { readonly Code?: string }[];
}

const asSdkError = (error: unknown): SdkErrorLike => (typeof error === "object" && error !== null ? error : {});

/**
 * The token on the item that made a put's condition false, or `undefined` when the answer isn't "the condition was
 * false".
 */
function failedConditionToken(error: unknown): { readonly token: string | undefined } | undefined {
  const { name, Item } = asSdkError(error);
  return name === "ConditionalCheckFailedException" ? { token: Item?.token?.S } : undefined;
}

/**
 * Whether a transaction was refused because a condition was false. A cancellation for another reason, such as a
 * conflict with another transaction or throttling, says nothing about the items, so it is not a refusal.
 */
function transactionRefused(error: unknown): boolean {
  const { name, CancellationReasons } = asSdkError(error);
  return (
    name === "TransactionCanceledException" &&
    CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed") === true
  );
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
  const lost = async (key: string): Promise<EffectClaim> => lostClaim(key, await read(key));
  /**
   * A put that needs `condition`, answering whether it took effect. The SDK retries a put after a timeout or a server
   * error, and a retry of a put that already took effect fails its own condition. DynamoDB then returns the item that
   * made it fail, and when that item carries this call's token it is this call's own write, so the put counts as won.
   * Each call has a token of its own, so another caller's write never does.
   */
  const put = async (
    record: EffectRecord,
    condition: string,
    names: Record<string, string>,
    values?: Attributes,
  ): Promise<boolean> => {
    const token = crypto.randomUUID();
    try {
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: item(record, token),
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ...(values === undefined ? {} : { ExpressionAttributeValues: values }),
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }),
      );
      return true;
    } catch (error) {
      const failed = failedConditionToken(error);
      if (failed === undefined) throw error;
      return failed.token === token;
    }
  };
  return {
    async begin(record) {
      return (await put(record, "attribute_not_exists(#pk)", { "#pk": "pk" })) ? "started" : lost(record.key);
    },
    async takeOver(record) {
      const won = await put(
        record,
        "attribute_not_exists(#pk) OR #attempt = :previous",
        { "#pk": "pk", "#attempt": "attempt" },
        { ":previous": { N: String(record.attempt - 1) } },
      );
      return won ? "started" : lost(record.key);
    },
    async settle(record) {
      return put(
        record,
        "#state = :started AND #attempt = :attempt",
        { "#state": "state", "#attempt": "attempt" },
        { ":started": { S: "started" }, ":attempt": { N: String(record.attempt) } },
      );
    },
    get: read,
  };
}

/**
 * A `PlanLedger` on DynamoDB. Step `n` is an item that exists once the step passed. A claim of step `n` is one
 * transaction: put the item for `n` if it is absent, and check that the item for `n - 1` exists. The transaction
 * carries a `ClientRequestToken`, so an SDK retry of a claim that already took effect is answered as the same claim,
 * not as a replay. When the transaction is refused because a condition was false, a read of the item for `n` tells
 * `replayed` from `out_of_order`; a cancellation for any other reason is rethrown.
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
      assertStepIndex(stepIndex);
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
        await client.send(
          new TransactWriteItemsCommand({ TransactItems: [...earlier, put], ClientRequestToken: crypto.randomUUID() }),
        );
        return "claimed" as const;
      } catch (error) {
        if (!transactionRefused(error)) throw error;
        return (await exists(planId, stepIndex)) ? ("replayed" as const) : ("out_of_order" as const);
      }
    },
  });
}
