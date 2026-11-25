/**
 * What the DynamoDB session store and lock share: the table's key layout, the option checks and how an AWS SDK error
 * is read. Both put one user's items in one partition, `pk = u#<user>`, or `n#<namespace>#u#<user>` under a namespace,
 * and tell item kinds apart by the sort key's prefix: `h#` for a session's head, `e#` for its entries and `l#` for its
 * lock. User and session ids are written with `encodeName()`, which never yields `#`, so no id can reach another id's
 * items.
 */
import { HarnessError } from "../errors.js";
import { encodeName, type SessionKey } from "../session/store.js";
import { errorName } from "./sdk.js";

/** The options both DynamoDB adapters take. */
export interface DynamoTableOptions {
  /**
   * The table. It needs a string partition key named `pk` and a string sort key named `sk`, and the store and the lock
   * may share it.
   */
  readonly tableName: string;
  /**
   * A name that keeps these items apart from other deployments' items in the same table, such as `staging`: 1 to 32
   * lower-case letters, digits, `_` or `-`. Default: none. The store and the lock of one deployment use the same one.
   */
  readonly namespace?: string;
}

/** A string attribute, as the SDK writes one. */
type S = { readonly S: string };
/** An item as these adapters read it: every attribute they write is a string or a number. */
export type Item = Record<string, { readonly S?: string; readonly N?: string }>;

/** Where a session's items go in the table. */
export interface Layout {
  /** The partition of a user's items. */
  readonly userPk: (userId: string) => S;
  /** The sort key of a session's item of one kind. */
  readonly sortKey: (kind: "h" | "e" | "l", key: SessionKey, rest?: string) => S;
  /** The primary key of a session's item of one kind. */
  readonly itemKey: (kind: "h" | "e" | "l", key: SessionKey, rest?: string) => { readonly pk: S; readonly sk: S };
}

const NAMESPACE = /^[a-z0-9_-]{1,32}$/;

/** The key layout for `options.namespace`. Throws `invalid_aws_options` for a namespace it can't use. */
export function layoutOf(adapter: string, options: DynamoTableOptions): Layout {
  const { namespace } = options;
  if (namespace !== undefined && (typeof namespace !== "string" || !NAMESPACE.test(namespace))) {
    throw new HarnessError("invalid_aws_options", `${adapter} needs a namespace of 1 to 32 of a-z, 0-9, _ or -`);
  }
  const prefix = namespace === undefined ? "" : `n#${namespace}#`;
  const userPk = (userId: string): S => ({ S: `${prefix}u#${encodeName(userId)}` });
  const sortKey = (kind: "h" | "e" | "l", key: SessionKey, rest = ""): S => ({
    S: `${kind}#${encodeName(key.sessionId)}${rest}`,
  });
  return { userPk, sortKey, itemKey: (kind, key, rest) => ({ pk: userPk(key.userId), sk: sortKey(kind, key, rest) }) };
}

// DynamoDB's own rule for a table name: 3 to 255 of these characters.
const TABLE_NAME = /^[a-zA-Z0-9_.-]{3,255}$/;

/** Throws `invalid_aws_options` unless `options.tableName` is a name DynamoDB accepts. */
export function checkTableName(adapter: string, options: DynamoTableOptions | undefined): string {
  const name = options?.tableName;
  if (typeof name !== "string" || !TABLE_NAME.test(name)) {
    throw new HarnessError(
      "invalid_aws_options",
      `${adapter} needs a tableName of 3 to 255 letters, digits, _, . or -`,
    );
  }
  return name;
}

/**
 * The item a conditional write met, when the write failed only because its condition was false. `undefined` means the
 * error was something else, which the caller rethrows. `{ item: undefined }` means the condition was false and no item
 * existed.
 */
export function conditionFailed(error: unknown): { readonly item: Item | undefined } | undefined {
  if (errorName(error) !== "ConditionalCheckFailedException") return undefined;
  return { item: (error as { readonly Item?: Item }).Item };
}

/** A string attribute's value, or `undefined`. */
export const str = (item: Item | undefined, name: string): string | undefined => item?.[name]?.S;

/** A number attribute's value, or `undefined` when it is missing or not a finite number. */
export function num(item: Item | undefined, name: string): number | undefined {
  const text = item?.[name]?.N;
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}
