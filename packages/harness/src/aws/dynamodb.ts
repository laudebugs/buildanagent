/**
 * `@buildanagent/harness/aws/dynamodb`: the session store and the session lock on Amazon DynamoDB, through an
 * `@aws-sdk/client-dynamodb` client the host makes. Both use a table with a string partition key `pk` and a string
 * sort key `sk`, and may share one.
 *
 * @module @buildanagent/harness/aws/dynamodb
 */
export type { DynamoTableOptions } from "./dynamodb-common.js";
export { type DynamoLockHandle, type DynamoLockOptions, dynamoLock } from "./dynamodb-lock.js";
export { type DynamoStoreOptions, dynamoStore, MAX_DYNAMO_ENTRY_BYTES } from "./dynamodb-store.js";
