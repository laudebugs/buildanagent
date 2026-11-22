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
  ClientRequestToken?: string;
  ReturnValuesOnConditionCheckFailure?: string;
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

/** The `#name` and `:value` tokens that an expression uses. */
function tokensOf(expression: string | undefined, prefix: "#" | ":"): Set<string> {
  return new Set((expression ?? "").match(prefix === "#" ? /#\w+/g : /:\w+/g) ?? []);
}

/**
 * What DynamoDB says when the names or values a request carries are not the ones its expression uses: a name or value
 * that no expression uses, or one that the expression needs and the request lacks. `undefined` when they match.
 */
function expressionProblem(part: {
  ConditionExpression?: string;
  ExpressionAttributeNames?: Names;
  ExpressionAttributeValues?: Values;
}): string | undefined {
  const checks = [
    [
      "ExpressionAttributeNames",
      Object.keys(part.ExpressionAttributeNames ?? {}),
      tokensOf(part.ConditionExpression, "#"),
    ],
    [
      "ExpressionAttributeValues",
      Object.keys(part.ExpressionAttributeValues ?? {}),
      tokensOf(part.ConditionExpression, ":"),
    ],
  ] as const;
  for (const [field, provided, used] of checks) {
    const unused = provided.filter((token) => !used.has(token));
    if (unused.length > 0) return `Value provided in ${field} unused in expressions: keys: {${unused.join(", ")}}`;
    const missing = [...used].filter((token) => !provided.includes(token));
    if (missing.length > 0) return `An expression attribute in ${field} is not defined: {${missing.join(", ")}}`;
  }
  return undefined;
}

const VALIDATION = "com.amazon.coral.validate#ValidationException";
const SERVER_ERROR = "com.amazonaws.dynamodb.v20120810#InternalServerError";
const MISMATCH = "com.amazonaws.dynamodb.v20120810#IdempotentParameterMismatchException";
const CONDITION_FAILED = "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException";
const CANCELED = "com.amazonaws.dynamodb.v20120810#TransactionCanceledException";

/** A fake DynamoDB, the SDK client that talks to it, and the requests it has received. */
export function fakeDynamoDb() {
  const items = new Map<string, Item>();
  // The request tokens of transactions that took effect, with their parameters, as DynamoDB keeps them for ten minutes.
  const tokens = new Map<string, string>();
  // Faults for the next requests: a response lost after the write took effect, and a transaction cancelled for a reason
  // that says nothing about its conditions.
  const lose: string[] = [];
  const cancel: string[][] = [];
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
  const invalid = (message: string) => answer(400, { __type: VALIDATION, message });

  /** Whether the condition on one part of a request holds for the item it names. */
  const partHolds = (part: Part, fallback?: Part): boolean =>
    holds(
      part.ConditionExpression,
      part.ExpressionAttributeNames ?? fallback?.ExpressionAttributeNames ?? {},
      part.ExpressionAttributeValues ?? fallback?.ExpressionAttributeValues ?? {},
      get(part.Item ?? part.Key),
    );

  function putItem(body: Body) {
    const problem = expressionProblem(body);
    if (problem !== undefined) return invalid(problem);
    const item = required(body.Item);
    if (!partHolds(body)) {
      const old = get(item);
      // `ReturnValuesOnConditionCheckFailure: ALL_OLD` returns the item that made the condition false.
      const returned = body.ReturnValuesOnConditionCheckFailure === "ALL_OLD" && old !== undefined ? { Item: old } : {};
      return fail(CONDITION_FAILED, returned);
    }
    items.set(String(item.pk?.S), item);
    return answer(200, {});
  }

  /** The first problem with the expressions of a transaction's parts, if any. */
  function transactionProblem(entries: NonNullable<Body["TransactItems"]>): string | undefined {
    for (const entry of entries) {
      const problem = expressionProblem(required(entry.Put ?? entry.ConditionCheck));
      if (problem !== undefined) return problem;
    }
    return undefined;
  }

  /** The answer to a retried transaction whose token DynamoDB remembers, or `undefined` for a new one. */
  function replay(body: Body, payload: string) {
    const seen = body.ClientRequestToken === undefined ? undefined : tokens.get(body.ClientRequestToken);
    if (seen === undefined) return undefined;
    return seen === payload ? answer(200, {}) : fail(MISMATCH, { message: "The token was used with other parameters" });
  }

  function transactWriteItems(body: Body) {
    const entries = body.TransactItems ?? [];
    const problem = transactionProblem(entries);
    if (problem !== undefined) return invalid(problem);
    const payload = JSON.stringify(entries);
    const replayed = replay(body, payload);
    if (replayed !== undefined) return replayed;
    const cancelled = cancel.shift();
    if (cancelled !== undefined) return fail(CANCELED, { CancellationReasons: cancelled.map((Code) => ({ Code })) });
    const checks = entries.map((entry) => partHolds(required(entry.Put ?? entry.ConditionCheck)));
    if (checks.some((ok) => !ok)) {
      const reasons = checks.map((ok) => ({ Code: ok ? "None" : "ConditionalCheckFailed" }));
      return fail(CANCELED, { CancellationReasons: reasons });
    }
    applyTransaction(entries, body.ClientRequestToken, payload);
    return answer(200, {});
  }

  /** Writes a transaction's puts and remembers its token. */
  function applyTransaction(entries: NonNullable<Body["TransactItems"]>, token: string | undefined, payload: string) {
    for (const entry of entries) {
      const item = entry.Put?.Item;
      if (item !== undefined) items.set(String(item.pk?.S), item);
    }
    if (token !== undefined) tokens.set(token, payload);
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
      const answered = operate(operation, body);
      // A lost response: the write took effect, and the caller gets a server error it will retry.
      if (lose.length > 0 && lose[0] === operation && answered.response.statusCode === 200) {
        lose.shift();
        return answer(500, { __type: SERVER_ERROR, message: "Internal server error" });
      }
      return answered;
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs: () => ({}),
  };

  const client = new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: handler as never,
    // The SDK's retries are on, as a deployed client's are, so a lost response is retried as it would be.
    maxAttempts: 3,
  });
  return {
    client,
    requests,
    items,
    /** The next `operation` takes effect, but its response is lost: the caller gets a server error, which it retries. */
    loseNextResponse(operation: "PutItem" | "TransactWriteItems") {
      lose.push(operation);
    },
    /** The next transaction is cancelled with these reason codes and changes nothing, as under a conflict or throttling. */
    cancelNextTransaction(...codes: string[]) {
      cancel.push(codes);
    },
    /** Forgets every item, token, fault and request, so each conformance case starts empty. */
    reset() {
      items.clear();
      tokens.clear();
      lose.length = 0;
      cancel.length = 0;
      requests.length = 0;
    },
  };
}
