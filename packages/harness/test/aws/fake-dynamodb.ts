// An in-process DynamoDB for the adapters' offline tests. It takes the SDK's real command objects through `send()`,
// keeps items in memory under `pk` and an optional `sk`, and answers the way DynamoDB does for the parts of the API the
// adapters use: GetItem, PutItem, UpdateItem, DeleteItem, Query and BatchWriteItem. It applies condition expressions
// built from `attribute_exists`, `attribute_not_exists`, `=` and `<`, joined by AND or OR; refuses an expression name
// or value that no expression uses, as DynamoDB does; enforces the 400 KB item and 25-request batch limits; and pages
// a Query after a few items, so the adapters' pagination runs. It throws the SDK's own exception classes.
//
// Each request runs to the end before the next starts, which is how DynamoDB applies writes to one item, so a
// concurrent test is serialized here. It proves the requests and the adapters' reading of the answers, not DynamoDB's
// own atomicity; the opt-in live run checks that.
import {
  type BatchWriteItemCommandInput,
  ConditionalCheckFailedException,
  type DynamoDBClient,
  DynamoDBServiceException,
  type PutItemCommandInput,
  type QueryCommandInput,
  type UpdateItemCommandInput,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";

type Value = { S?: string; N?: string };
type Item = Record<string, Value>;
type Names = Record<string, string>;
type Values = Record<string, Value>;
type Table = Map<string, Item>;

/** The condition fields of a write, typed as the fake reads them. */
interface Conditional {
  readonly ConditionExpression?: string | undefined;
  readonly ExpressionAttributeNames?: Names | undefined;
  readonly ExpressionAttributeValues?: Values | undefined;
  readonly ReturnValuesOnConditionCheckFailure?: string | undefined;
}

const ITEM_LIMIT = 400 * 1024;
const BATCH_LIMIT = 25;

function invalid(message: string): never {
  throw new DynamoDBServiceException({
    name: "ValidationException",
    $fault: "client",
    $metadata: { httpStatusCode: 400 },
    message,
  });
}

/** Refuses a `#name` or `:value` the request supplies and no expression uses, or one an expression uses and lacks. */
function checkTokens(expressions: (string | undefined)[], names: Names = {}, values: Values = {}): void {
  const text = expressions.filter(Boolean).join(" ");
  for (const [field, supplied, used] of [
    ["ExpressionAttributeNames", Object.keys(names), new Set(text.match(/#\w+/g) ?? [])],
    ["ExpressionAttributeValues", Object.keys(values), new Set(text.match(/:\w+/g) ?? [])],
  ] as const) {
    const unused = supplied.filter((token) => !used.has(token));
    if (unused.length > 0) invalid(`Value provided in ${field} unused in expressions: keys: {${unused.join(", ")}}`);
    const missing = [...used].filter((token) => !supplied.includes(token));
    if (missing.length > 0) invalid(`An expression attribute in ${field} is not defined: {${missing.join(", ")}}`);
  }
}

function compare(a: Value | undefined, b: Value | undefined): number | undefined {
  if (a?.N !== undefined && b?.N !== undefined) return Number(a.N) - Number(b.N);
  if (a?.S !== undefined && b?.S !== undefined) return a.S < b.S ? -1 : a.S > b.S ? 1 : 0;
  return undefined;
}

function term(text: string, names: Names, values: Values, item: Item | undefined): boolean {
  const exists = /^attribute_(not_)?exists\((#\w+)\)$/.exec(text);
  if (exists) return (item !== undefined && String(names[exists[2] as string]) in item) === (exists[1] === undefined);
  const comparison = /^(#\w+) (=|<) (:\w+)$/.exec(text);
  if (comparison === null) throw new Error(`the fake DynamoDB does not understand the condition ${text}`);
  const order = compare(item?.[String(names[comparison[1] as string])], values[comparison[3] as string]);
  return order !== undefined && (comparison[2] === "=" ? order === 0 : order < 0);
}

function holds(input: Conditional, item: Item | undefined): boolean {
  const { ConditionExpression: expression, ExpressionAttributeNames: names = {} } = input;
  if (expression === undefined) return true;
  const values = input.ExpressionAttributeValues ?? {};
  return expression
    .split(" OR ")
    .some((all) => all.split(" AND ").every((part) => term(part.trim(), names, values, item)));
}

const size = (item: Item) =>
  Object.entries(item).reduce((sum, [name, value]) => sum + name.length + (value.S ?? value.N ?? "").length, 0);

function checkSize(item: Item): void {
  if (size(item) > ITEM_LIMIT) invalid("Item size has exceeded the maximum allowed size");
}

/** Applies one `SET #a = :a`, `REMOVE #a` or `ADD #a :n` clause to `item` in place. */
function applyClause(item: Item, keyword: string, clause: string, names: Names, values: Values): void {
  if (keyword === "REMOVE") {
    delete item[String(names[clause])];
    return;
  }
  const [name, value] = (keyword === "SET" ? clause.split(/\s*=\s*/) : clause.split(/\s+/)) as [string, string];
  const attribute = String(names[name]);
  item[attribute] =
    keyword === "SET"
      ? (values[value] as Value)
      : { N: String(Number(item[attribute]?.N ?? "0") + Number(values[value]?.N)) };
}

function update(item: Item, input: UpdateItemCommandInput): Item {
  const next = { ...item };
  const names = input.ExpressionAttributeNames ?? {};
  const values = (input.ExpressionAttributeValues ?? {}) as Values;
  for (const [, keyword, body] of String(input.UpdateExpression).matchAll(
    /(SET|REMOVE|ADD)\s+(.*?)(?=\s+(?:SET|REMOVE|ADD)\s|$)/g,
  )) {
    for (const clause of String(body).split(",")) applyClause(next, String(keyword), clause.trim(), names, values);
  }
  return next;
}

const id = (key: Item | undefined) => `${key?.pk?.S}\u0000${key?.sk?.S ?? ""}`;
const keyOf = (item: Item): Item => ({ pk: item.pk as Value, ...(item.sk === undefined ? {} : { sk: item.sk }) });
const sk = (item: Item) => item.sk?.S ?? "";

/** A Query's key condition, as a test of an item's sort key, for the two forms the adapters send. */
function keyMatcher(input: QueryCommandInput): {
  readonly pk: string | undefined;
  readonly matches: (key: string) => boolean;
} {
  const values = (input.ExpressionAttributeValues ?? {}) as Values;
  const names = input.ExpressionAttributeNames ?? {};
  const range = /^#\w+ = (:\w+) AND (?:begins_with\(#\w+, (:\w+)\)|#\w+ BETWEEN (:\w+) AND (:\w+))$/.exec(
    String(input.KeyConditionExpression),
  );
  if (range === null || names["#pk"] !== "pk" || names["#sk"] !== "sk") {
    throw new Error(`the fake DynamoDB does not understand the key condition ${input.KeyConditionExpression}`);
  }
  const [, pk, prefix, lo, hi] = range;
  const text = (token: string | undefined) => String(values[String(token)]?.S);
  return {
    pk: values[String(pk)]?.S,
    matches: prefix !== undefined ? (key) => key.startsWith(text(prefix)) : (key) => key >= text(lo) && key <= text(hi),
  };
}

/** The fake, the client the adapters take, and handles a test uses to inject faults and read what was stored. */
export function fakeDynamoDb(options: { readonly pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 7;
  const tables = new Map<string, Table>();
  const sent: string[] = [];
  const faults = { lose: [] as string[], unprocessed: 0 };
  const tableOf = (name: string | undefined): Table => {
    if (name === undefined) return invalid("TableName is required");
    const table = tables.get(name) ?? new Map<string, Item>();
    tables.set(name, table);
    return table;
  };

  function conditional(input: Conditional, existing: Item | undefined): void {
    if (holds(input, existing)) return;
    const returned = input.ReturnValuesOnConditionCheckFailure === "ALL_OLD" && existing !== undefined;
    throw new ConditionalCheckFailedException({
      message: "The conditional request failed",
      $metadata: { httpStatusCode: 400 },
      ...(returned ? { Item: structuredClone(existing) as never } : {}),
    });
  }

  function putItem(table: Table, input: PutItemCommandInput) {
    const item = input.Item as Item;
    checkTokens([input.ConditionExpression], input.ExpressionAttributeNames, input.ExpressionAttributeValues as Values);
    checkSize(item);
    conditional(input as Conditional, table.get(id(item)));
    table.set(id(item), structuredClone(item));
    return {};
  }

  function updateItem(table: Table, input: UpdateItemCommandInput) {
    const expressions = [input.ConditionExpression, input.UpdateExpression];
    checkTokens(expressions, input.ExpressionAttributeNames, input.ExpressionAttributeValues as Values);
    const key = input.Key as Item;
    const existing = table.get(id(key));
    conditional(input as Conditional, existing);
    const next = update({ ...existing, ...key }, input);
    table.set(id(key), next);
    return input.ReturnValues === "ALL_NEW" ? { Attributes: structuredClone(next) } : {};
  }

  function query(table: Table, input: QueryCommandInput) {
    const expressions = [input.KeyConditionExpression, input.ProjectionExpression];
    checkTokens(expressions, input.ExpressionAttributeNames, input.ExpressionAttributeValues as Values);
    if (input.ConsistentRead !== true) throw new Error("the adapters read consistently; this Query did not");
    const { pk, matches } = keyMatcher(input);
    const after = (input.ExclusiveStartKey as Item | undefined)?.sk?.S;
    const found = [...table.values()]
      .filter((item) => item.pk?.S === pk && matches(sk(item)) && (after === undefined || sk(item) > after))
      .sort((a, b) => (sk(a) < sk(b) ? -1 : 1));
    const page = found.slice(0, pageSize);
    return {
      Items: structuredClone(input.ProjectionExpression === undefined ? page : page.map(keyOf)),
      ...(found.length > pageSize ? { LastEvaluatedKey: keyOf(page.at(-1) as Item) } : {}),
    };
  }

  /** Applies the first `count` requests of a batch and returns the rest. */
  function applyBatch(table: Table, requests: WriteRequest[], count: number): WriteRequest[] {
    for (const request of requests.slice(0, count)) {
      const put = request.PutRequest?.Item as Item | undefined;
      if (put !== undefined) table.set(id(put), structuredClone(put));
      else table.delete(id(request.DeleteRequest?.Key as Item));
    }
    return requests.slice(count);
  }

  function batchWrite(table: Table, input: BatchWriteItemCommandInput) {
    const [name, requests] = Object.entries(input.RequestItems ?? {})[0] as [string, WriteRequest[]];
    if (requests.length > BATCH_LIMIT) invalid("Member must have length less than or equal to 25");
    const items = requests.map((request) => (request.PutRequest?.Item ?? request.DeleteRequest?.Key) as Item);
    if (new Set(items.map(id)).size !== items.length) invalid("Provided list of item keys contains duplicates");
    for (const item of items) checkSize(item);
    // A throttled batch: DynamoDB applies part of it and hands back the rest.
    const kept = faults.unprocessed > 0 ? 1 : requests.length;
    faults.unprocessed = Math.max(0, faults.unprocessed - 1);
    const rest = applyBatch(table, requests, kept);
    return { UnprocessedItems: rest.length === 0 ? {} : { [name]: rest } };
  }

  const handlers: Record<string, (table: Table, input: never) => unknown> = {
    GetItem: (table, input: { Key: Item }) => {
      const item = table.get(id(input.Key));
      return item === undefined ? {} : { Item: structuredClone(item) };
    },
    PutItem: putItem,
    UpdateItem: updateItem,
    DeleteItem: (table, input: { Key: Item }) => {
      table.delete(id(input.Key));
      return {};
    },
    Query: query,
    BatchWriteItem: batchWrite,
  };

  function operate(operation: string, input: { TableName?: string; RequestItems?: object }): unknown {
    const handler = handlers[operation];
    if (handler === undefined) throw new Error(`the fake DynamoDB does not implement ${operation}`);
    return handler(tableOf(input.TableName ?? Object.keys(input.RequestItems ?? {})[0]), input as never);
  }

  const client = {
    async send(command: { constructor: { name: string }; input: { TableName?: string; RequestItems?: object } }) {
      const operation = command.constructor.name.replace(/Command$/, "");
      sent.push(operation);
      const answer = operate(operation, command.input);
      if (faults.lose[0] !== operation) return answer;
      // The write took effect and its response was lost, so the SDK sends the same request again, as its retry does.
      faults.lose.shift();
      sent.push(operation);
      return operate(operation, command.input);
    },
  };

  return {
    client: client as unknown as DynamoDBClient,
    /** The operations sent so far, in order, with a resent request counted twice. */
    sent,
    /** Every item of `table`, in key order. */
    items(table: string): Item[] {
      return [...(tables.get(table)?.values() ?? [])].sort((a, b) => (id(a) < id(b) ? -1 : 1));
    },
    /** Writes an item straight into `table`, as another process or a damaged table would. */
    put(table: string, item: Item): void {
      tableOf(table).set(id(item), structuredClone(item));
    },
    /** The next `operation` takes effect, then its response is lost and the request is sent again. */
    loseNextResponse(operation: "PutItem" | "UpdateItem") {
      faults.lose.push(operation);
    },
    /** The next `count` batch writes apply only their first request and return the rest as unprocessed. */
    leaveUnprocessed(count: number) {
      faults.unprocessed = count;
    },
  };
}
