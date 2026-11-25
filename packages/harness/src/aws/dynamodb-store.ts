/**
 * `dynamoStore()`: a `SessionStore` on DynamoDB. An append writes its entries as new items first, each under a sort key
 * that names its batch, and then commits them with one conditional put of the session's head item, which must still
 * name the batch the append read. Only the head says which items are the log, so a write that loses the race, or a
 * process that dies before its commit, leaves items no reader follows, and a batch of any size is written whole or not
 * at all.
 */
import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  type DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type PutItemCommandInput,
  QueryCommand,
  type QueryCommandInput,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";
import { parseEntry, type SessionEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import { ConflictError } from "../session/errors.js";
import {
  type AppendOptions,
  byAge,
  checkKey,
  DEFAULT_MAX_ENTRY_BYTES,
  type EntryInput,
  encodeName,
  extendState,
  type LoadOptions,
  type LogState,
  planAppend,
  type SessionKey,
  type SessionStore,
  type SessionSummary,
  stateOf,
  summaryOf,
} from "../session/store.js";
import {
  checkTableName,
  conditionFailed,
  type DynamoTableOptions,
  type Item,
  type Layout,
  layoutOf,
  num,
  str,
} from "./dynamodb-common.js";
import { checkClient } from "./sdk.js";

/** The largest `maxEntryBytes` the store accepts, so an entry's item stays under DynamoDB's 400 KB item limit. */
export const MAX_DYNAMO_ENTRY_BYTES = 300 * 1024;

/** The options of `dynamoStore()`. */
export interface DynamoStoreOptions extends DynamoTableOptions {
  /** The bound on one entry's JSON, in bytes. Default 64 KiB, and at most `MAX_DYNAMO_ENTRY_BYTES`. */
  readonly maxEntryBytes?: number;
}

// A sequence number in a sort key, padded so the keys sort in sequence order.
const SEQ_WIDTH = 12;
// DynamoDB takes at most 25 puts or deletes in one BatchWriteItem.
const BATCH_LIMIT = 25;
// How many times an append reads the head again after another writer committed first, when it names no expected tail.
const COMMIT_TRIES = 5;
// How many times a batch write resends the requests DynamoDB left unprocessed.
const UNPROCESSED_TRIES = 8;
// How many sessions' log state the store keeps, as the JSONL store does.
const CACHE_SIZE = 64;

const pad = (seq: number) => String(seq).padStart(SEQ_WIDTH, "0");

/** What the head item holds: the batch that committed last, and where the log ends. */
interface Head {
  readonly batch: string;
  readonly lastSeq: number;
  readonly lastId: string;
  readonly lastEntryAt: string;
  readonly summary: string;
}

/** One entry item, as the chain walk reads it. */
interface Link {
  readonly seq: number;
  readonly batch: string;
  /** The batch that committed before this one, or `""` for a session's first batch. */
  readonly prev: string;
  /** The first sequence number of this item's batch. */
  readonly first: number;
  readonly text: string;
}

const corrupt = (why: string) => new HarnessError("session_corrupt", `the DynamoDB session log is damaged: ${why}`);

function headOf(item: Item | undefined): Head | undefined {
  if (item === undefined) return undefined;
  const head = {
    batch: str(item, "batch"),
    lastSeq: num(item, "lastSeq"),
    lastId: str(item, "lastId"),
    lastEntryAt: str(item, "lastEntryAt"),
    summary: str(item, "summary"),
  };
  if (Object.values(head).some((value) => value === undefined)) throw corrupt("a head item lacks a field");
  return head as Head;
}

function linkOf(item: Item): Link {
  const link = {
    seq: num(item, "seq"),
    batch: str(item, "batch"),
    prev: str(item, "prev"),
    first: num(item, "first"),
    text: str(item, "entry"),
  };
  if (Object.values(link).some((value) => value === undefined)) throw corrupt("an entry item lacks a field");
  return link as Link;
}

/** The entries of the committed log from `from` on, by walking from the head's batch back through each batch's `prev`. */
interface Walk {
  readonly texts: string[];
  /** The first sequence number and the `prev` of the earliest batch the walk read, or `undefined` when it read none. */
  readonly boundary?: { readonly first: number; readonly prev: string };
}

function walk(head: Head, links: readonly Link[], from: number): Walk {
  const batches = new Map<string, Map<number, Link>>();
  for (const link of links) {
    const batch = batches.get(link.batch) ?? new Map<number, Link>();
    batches.set(link.batch, batch);
    batch.set(link.seq, link);
  }
  const texts: string[] = [];
  let last = head.lastSeq;
  let batchId = head.batch;
  let boundary: Walk["boundary"];
  while (last >= from) {
    const batch = batches.get(batchId);
    const sample = batch?.get(last);
    if (batch === undefined || sample === undefined) throw corrupt(`entry ${last} of a committed batch is missing`);
    for (let seq = last; seq >= Math.max(sample.first, from); seq -= 1) {
      const link = batch.get(seq);
      if (link === undefined) throw corrupt(`entry ${seq} of a committed batch is missing`);
      texts.push(link.text);
    }
    boundary = { first: sample.first, prev: sample.prev };
    if (sample.first <= from) break;
    last = sample.first - 1;
    batchId = sample.prev;
  }
  return { texts: texts.reverse(), ...(boundary === undefined ? {} : { boundary }) };
}

function parsed(text: string): SessionEntry {
  try {
    return parseEntry(JSON.parse(text));
  } catch {
    throw corrupt("an entry item does not hold a valid entry");
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const cacheKey = (key: SessionKey) => `${encodeName(key.userId)}/${encodeName(key.sessionId)}`;

/** The head item that commits `fresh` as batch `batch`. */
function headItem(
  layout: Layout,
  key: SessionKey,
  head: Head | undefined,
  fresh: readonly SessionEntry[],
  batch: string,
) {
  const last = fresh.at(-1) as SessionEntry;
  return {
    ...layout.itemKey("h", key),
    sessionId: { S: key.sessionId },
    batch: { S: batch },
    lastSeq: { N: String(last.seq) },
    lastId: { S: last.id },
    lastEntryAt: { S: last.timestamp },
    summary: { S: head?.summary ?? JSON.stringify(summaryOf(key.sessionId, [fresh[0] as SessionEntry])) },
  };
}

/** The condition a commit needs: no head yet, or the head this append read. */
function commitCondition(
  head: Head | undefined,
): Pick<PutItemCommandInput, "ConditionExpression" | "ExpressionAttributeNames" | "ExpressionAttributeValues"> {
  return head === undefined
    ? { ConditionExpression: "attribute_not_exists(#sk)", ExpressionAttributeNames: { "#sk": "sk" } }
    : {
        ConditionExpression: "#batch = :batch",
        ExpressionAttributeNames: { "#batch": "batch" },
        ExpressionAttributeValues: { ":batch": { S: head.batch } },
      };
}

function summaryFrom(item: Item): SessionSummary {
  const head = headOf(item) as Head;
  let summary: SessionSummary;
  try {
    summary = JSON.parse(head.summary) as SessionSummary;
  } catch {
    throw corrupt("a head item's summary is not JSON");
  }
  return { ...summary, lastEntryAt: head.lastEntryAt, entryCount: head.lastSeq + 1 };
}

function rawEntry(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw corrupt("an entry item does not hold JSON");
  }
}

class DynamoStore implements SessionStore {
  readonly #client: DynamoDBClient;
  readonly #table: string;
  readonly #maxBytes: number;
  readonly #layout: Layout;
  readonly #cache = new Map<string, { readonly batch: string; readonly state: LogState }>();

  constructor(client: DynamoDBClient, table: string, maxBytes: number, layout: Layout) {
    this.#client = client;
    this.#table = table;
    this.#maxBytes = maxBytes;
    this.#layout = layout;
  }

  #entryKey(key: SessionKey, entry: SessionEntry, batch: string) {
    return this.#layout.itemKey("e", key, `#${pad(entry.seq)}#${batch}`);
  }

  async #head(key: SessionKey): Promise<Head | undefined> {
    const { Item } = await this.#client.send(
      new GetItemCommand({ TableName: this.#table, Key: this.#layout.itemKey("h", key), ConsistentRead: true }),
    );
    return headOf(Item as Item | undefined);
  }

  async #queryAll(input: Omit<QueryCommandInput, "TableName" | "ConsistentRead">): Promise<Item[]> {
    const items: Item[] = [];
    let start: QueryCommandInput["ExclusiveStartKey"];
    do {
      const page = await this.#client.send(
        new QueryCommand({ ...input, TableName: this.#table, ConsistentRead: true, ExclusiveStartKey: start }),
      );
      items.push(...((page.Items ?? []) as Item[]));
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return items;
  }

  #prefixed(key: SessionKey, prefix: string, projection?: string) {
    return this.#queryAll({
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": this.#layout.userPk(key.userId), ":prefix": { S: prefix } },
      ...(projection === undefined ? {} : { ProjectionExpression: projection }),
    });
  }

  /** The committed log's entries from `from` on, as the head names them. */
  async #readLog(key: SessionKey, head: Head, from: number): Promise<Walk> {
    if (head.lastSeq < from) return { texts: [] };
    const items = await this.#queryAll({
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :lo AND :hi",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: {
        ":pk": this.#layout.userPk(key.userId),
        ":lo": this.#layout.sortKey("e", key, `#${pad(from)}`),
        // `~` sorts after every character of a batch id, so the range ends after the last entry's every batch.
        ":hi": this.#layout.sortKey("e", key, `#${pad(head.lastSeq)}#~`),
      },
    });
    return walk(head, items.map(linkOf), from);
  }

  /** The head and the log state it names, from the cache when the head still names the cached batch. */
  async #stateFor(key: SessionKey): Promise<{ head: Head | undefined; state: LogState }> {
    const id = cacheKey(key);
    const head = await this.#head(key);
    if (head === undefined) {
      this.#cache.delete(id);
      return { head, state: stateOf([]) };
    }
    const cached = this.#cache.get(id);
    let state = cached?.batch === head.batch ? cached.state : undefined;
    if (state === undefined && cached !== undefined && head.lastSeq > cached.state.lastSeq) {
      // Only the batches committed since the cached one are read, when they lead back to it.
      const since = await this.#readLog(key, head, cached.state.lastSeq + 1);
      if (since.boundary?.first === cached.state.lastSeq + 1 && since.boundary.prev === cached.batch) {
        const copy = { byId: new Map(cached.state.byId), lastId: cached.state.lastId, lastSeq: cached.state.lastSeq };
        state = extendState(copy, since.texts.map(parsed));
      }
    }
    state ??= stateOf((await this.#readLog(key, head, 0)).texts.map(parsed));
    this.#remember(id, head.batch, state);
    return { head, state };
  }

  #remember(id: string, batch: string, state: LogState): void {
    this.#cache.delete(id);
    this.#cache.set(id, { batch, state });
    if (this.#cache.size > CACHE_SIZE) this.#cache.delete(this.#cache.keys().next().value as string);
  }

  /** Sends puts or deletes in batches of 25, resending what DynamoDB leaves unprocessed. */
  async #batchWrite(requests: readonly WriteRequest[]): Promise<void> {
    for (let at = 0; at < requests.length; at += BATCH_LIMIT) {
      let pending = requests.slice(at, at + BATCH_LIMIT);
      for (let attempt = 0; pending.length > 0; attempt += 1) {
        if (attempt >= UNPROCESSED_TRIES) {
          throw new HarnessError(
            "aws_write_incomplete",
            "DynamoDB left part of a batch write unprocessed after every retry, so the append was not committed",
          );
        }
        if (attempt > 0) await sleep(Math.min(1_000, 25 * 2 ** attempt));
        const out = await this.#client.send(new BatchWriteItemCommand({ RequestItems: { [this.#table]: pending } }));
        pending = out.UnprocessedItems?.[this.#table] ?? [];
      }
    }
  }

  /** Writes the batch's entries as items no head names yet. */
  #stage(key: SessionKey, fresh: readonly SessionEntry[], batch: string, prev: string): Promise<void> {
    const first = String(fresh[0]?.seq ?? 0);
    return this.#batchWrite(
      fresh.map((entry) => ({
        PutRequest: {
          Item: {
            ...this.#entryKey(key, entry, batch),
            seq: { N: String(entry.seq) },
            batch: { S: batch },
            prev: { S: prev },
            first: { N: first },
            entry: { S: JSON.stringify(entry) },
          },
        },
      })),
    );
  }

  #unstage(key: SessionKey, fresh: readonly SessionEntry[], batch: string): Promise<void> {
    return this.#batchWrite(fresh.map((entry) => ({ DeleteRequest: { Key: this.#entryKey(key, entry, batch) } })));
  }

  /** Puts the head that names `batch`, if the head still names the batch this append read. */
  async #commit(key: SessionKey, head: Head | undefined, fresh: readonly SessionEntry[], batch: string) {
    try {
      await this.#client.send(
        new PutItemCommand({
          TableName: this.#table,
          Item: headItem(this.#layout, key, head, fresh, batch),
          ...commitCondition(head),
          ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }),
      );
      return true;
    } catch (error) {
      const failed = conditionFailed(error);
      if (failed === undefined) throw error;
      // The SDK resends a put whose response was lost, and the resent put meets the head this append already wrote.
      return str(failed.item, "batch") === batch;
    }
  }

  async append(key: SessionKey, inputs: readonly EntryInput[], options?: AppendOptions): Promise<SessionEntry[]> {
    checkKey(key);
    for (let attempt = 0; attempt < COMMIT_TRIES; attempt += 1) {
      const { head, state } = await this.#stateFor(key);
      const plan = planAppend(state, inputs, options, this.#maxBytes);
      if (plan.fresh.length === 0) return structuredClone(plan.result);
      const batch = globalThis.crypto.randomUUID();
      await this.#stage(key, plan.fresh, batch, head?.batch ?? "");
      if (await this.#commit(key, head, plan.fresh, batch)) {
        this.#remember(cacheKey(key), batch, extendState(state, plan.fresh));
        return structuredClone(plan.result);
      }
      // Another writer committed first. Its log is read again, and the plan rechecks the caller's expected tail.
      await this.#unstage(key, plan.fresh, batch).catch(() => undefined);
    }
    throw new ConflictError(`other writers committed first ${COMMIT_TRIES} times in a row; take the session's lock`);
  }

  async *#texts(key: SessionKey, from: number): AsyncGenerator<string> {
    const head = await this.#head(key);
    // The whole log is read before the first entry is yielded, so an append made while a caller iterates isn't seen.
    if (head !== undefined) yield* (await this.#readLog(key, head, from)).texts;
  }

  load(key: SessionKey, options?: LoadOptions): AsyncIterable<SessionEntry> {
    checkKey(key);
    const fromSeq = options?.fromSeq;
    const from = fromSeq !== undefined && Number.isFinite(fromSeq) ? Math.max(0, Math.ceil(fromSeq)) : 0;
    const texts = this.#texts(key, from);
    return (async function* () {
      for await (const text of texts) yield parsed(text);
    })();
  }

  loadRaw(key: SessionKey): AsyncIterable<unknown> {
    checkKey(key);
    const texts = this.#texts(key, 0);
    return (async function* () {
      for await (const text of texts) yield rawEntry(text);
    })();
  }

  list(userId: string): AsyncIterable<SessionSummary> {
    checkKey({ userId, sessionId: "-" });
    const heads = this.#prefixed({ userId, sessionId: "-" }, "h#");
    return (async function* () {
      yield* (await heads).map(summaryFrom).sort(byAge);
    })();
  }

  async delete(key: SessionKey): Promise<void> {
    checkKey(key);
    // The entry items are listed before the head goes, so a session created again under this key keeps its own.
    const items = await this.#prefixed(key, this.#layout.sortKey("e", key, "#").S, "#pk, #sk");
    await this.#client.send(new DeleteItemCommand({ TableName: this.#table, Key: this.#layout.itemKey("h", key) }));
    this.#cache.delete(cacheKey(key));
    await this.#batchWrite(
      items.map((item) => ({
        DeleteRequest: { Key: { pk: { S: str(item, "pk") ?? "" }, sk: { S: str(item, "sk") ?? "" } } },
      })),
    );
  }
}

/**
 * A `SessionStore` on a DynamoDB table with a string partition key `pk` and a string sort key `sk`. It follows every
 * rule of the interface: an append is idempotent by entry id, compares `expectedLastId` and is written whole or not at
 * all, whatever its size. Every read is strongly consistent.
 *
 * Each user's sessions share one partition. A session is a head item, which names the batch that committed last and
 * the session's summary for `list()`, and one item per entry. An append writes its entries as new items whose sort
 * keys name the append's own random batch id, then puts the head on the condition that it still names the batch the
 * append read. The head is the commit: a reader follows it from batch to batch, so items that no head reaches are
 * never read as the log. An append that loses the race deletes its items, and one whose process dies leaves them
 * until `delete()`. A lost response is retried by the SDK, and the store tells its own retried commit by the batch id
 * the failed condition returns.
 *
 * The store keeps the state of the 64 sessions used last and checks it against the head on every append, so another
 * process's commit is seen at once. Two writers still need a `SessionLock`; without one, the head's condition makes
 * the second writer's append retry or throw a `ConflictError`, and it never interleaves two logs.
 */
export function dynamoStore(client: DynamoDBClient, options: DynamoStoreOptions): SessionStore {
  checkClient("dynamoStore()", client);
  const table = checkTableName("dynamoStore()", options);
  const maxBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_DYNAMO_ENTRY_BYTES) {
    throw new HarnessError(
      "invalid_aws_options",
      `dynamoStore() needs a maxEntryBytes that is a whole number from 1 to ${MAX_DYNAMO_ENTRY_BYTES}`,
    );
  }
  return new DynamoStore(client, table, maxBytes, layoutOf("dynamoStore()", options));
}
