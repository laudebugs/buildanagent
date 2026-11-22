// A DynamoDB that speaks the wire protocol, for the AWS SDK's `requestHandler`: the SDK builds, signs and sends its real
// requests, and this answers them in DynamoDB's JSON format, so nothing leaves the machine. It keeps items in memory,
// applies the condition expressions the stores use (`attribute_exists`, `attribute_not_exists`, `#name = :value`,
// joined by AND or OR) and refuses a condition that is false the way DynamoDB does. It records each request.
//
// What it proves is the request shape and the store's handling of DynamoDB's answers. It does not prove DynamoDB's own
// atomicity, and it runs one request at a time, so a concurrent test is serialized here; a live check belongs with a
// deploy.
import { Readable } from "node:stream";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

type Attribute = { S?: string; N?: string };
type Item = Record<string, Attribute>;
type Names = Record<string, string>;
type Values = Record<string, Attribute>;

/** The fields of a request, or of one part of a transaction, that the fake reads. */
interface Part {
  Item?: Item;
  Key?: Item;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Names;
  ExpressionAttributeValues?: Values;
}

interface Body extends Part {
  TransactItems?: { Put?: Part; ConditionCheck?: Part }[];
}

/** One request the fake received: the operation and its JSON body. */
export interface RecordedRequest {
  readonly operation: string;
  readonly body: Record<string, unknown>;
}

function term(text: string, names: Names, values: Values, item: Item | undefined): boolean {
  const exists = /^attribute_(not_)?exists\((#\w+)\)$/.exec(text);
  if (exists)
    return (
      (item !== undefined &&
        names[exists[2] as string] !== undefined &&
        (names[exists[2] as string] as string) in item) ===
      (exists[1] === undefined)
    );
  const equals = /^(#\w+) = (:\w+)$/.exec(text);
  if (equals) {
    const have = item?.[names[equals[1] as string] as string];
    const want = values[equals[2] as string];
    return have !== undefined && want !== undefined && have.S === want.S && have.N === want.N;
  }
  throw new Error(`the fake DynamoDB does not understand the condition term ${text}`);
}

/** Whether a condition expression holds for the stored item. */
function holds(expression: string | undefined, names: Names, values: Values, item: Item | undefined): boolean {
  if (expression === undefined) return true;
  return expression
    .split(" OR ")
    .some((all) => all.split(" AND ").every((part) => term(part.trim(), names, values, item)));
}

/** A field of a request that the SDK always sends for the operation being served. */
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("the fake DynamoDB got a request without a field it needs");
  return value;
}

const CONDITION_FAILED = "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException";
const CANCELED = "com.amazonaws.dynamodb.v20120810#TransactionCanceledException";

/** A fake DynamoDB, the SDK client that talks to it, and the requests it has received. */
export function fakeDynamoDb() {
  const items = new Map<string, Item>();
  const requests: RecordedRequest[] = [];
  const get = (key: Item | undefined) => items.get(String(key?.pk?.S));
  const answer = (statusCode: number, body: unknown) => ({
    response: {
      statusCode,
      headers: { "content-type": "application/x-amz-json-1.0" },
      body: Readable.from([Buffer.from(JSON.stringify(body))]),
    },
  });
  const fail = (type: string, extra: Record<string, unknown> = {}) =>
    answer(400, { __type: type, message: "The conditional request failed", ...extra });

  /** Whether the condition on one part of a request holds for the item it names. */
  const partHolds = (part: Part, fallback?: Part): boolean =>
    holds(
      part.ConditionExpression,
      part.ExpressionAttributeNames ?? fallback?.ExpressionAttributeNames ?? {},
      part.ExpressionAttributeValues ?? fallback?.ExpressionAttributeValues ?? {},
      get(part.Item ?? part.Key),
    );

  function putItem(body: Body) {
    const item = required(body.Item);
    if (!partHolds(body)) return fail(CONDITION_FAILED);
    items.set(String(item.pk?.S), item);
    return answer(200, {});
  }

  function transactWriteItems(body: Body) {
    const entries = body.TransactItems ?? [];
    const checks = entries.map((entry) => partHolds(required(entry.Put ?? entry.ConditionCheck)));
    if (checks.some((ok) => !ok)) {
      const reasons = checks.map((ok) => ({ Code: ok ? "None" : "ConditionalCheckFailed" }));
      return fail(CANCELED, { CancellationReasons: reasons });
    }
    for (const entry of entries) {
      const item = entry.Put?.Item;
      if (item !== undefined) items.set(String(item.pk?.S), item);
    }
    return answer(200, {});
  }

  function operate(operation: string, body: Body) {
    if (operation === "GetItem") {
      const item = get(body.Key);
      return answer(200, item === undefined ? {} : { Item: item });
    }
    if (operation === "PutItem") return putItem(body);
    if (operation === "TransactWriteItems") return transactWriteItems(body);
    throw new Error(`the fake DynamoDB does not implement ${operation}`);
  }

  const handler = {
    async handle(request: { headers: Record<string, string>; body?: unknown }) {
      const operation = String(request.headers["x-amz-target"]).split(".")[1] as string;
      const body = JSON.parse(String(request.body)) as Record<string, unknown>;
      requests.push({ operation, body });
      return operate(operation, body);
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs: () => ({}),
  };

  const client = new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: handler as never,
    maxAttempts: 1,
  });
  return {
    client,
    requests,
    items,
    /** Forgets every item and request, so each conformance case starts empty. */
    reset() {
      items.clear();
      requests.length = 0;
    },
  };
}
