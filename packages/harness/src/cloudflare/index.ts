/**
 * `@buildanagent/harness/cloudflare`: the harness's portable seams on Cloudflare. `doSqliteStore()` and
 * `doSqliteIndex()` keep the session log and its pointers in a Durable Object's SQLite storage, `doLock()` makes the
 * object the session's single writer, `doAlarmScheduler()` puts wakes on the object's alarm, `workerKeyStore()` reads
 * the approval key ring from a Worker secret or Secrets Store, and `webSocketHibernation()` serves the protocol over
 * hibernatable WebSockets. Each takes the object's `ctx.storage` or its sockets by their shape, so the module imports
 * neither Node nor Cloudflare's own types.
 *
 * @module @buildanagent/harness/cloudflare
 */
export { type AlarmScheduler, type DoAlarmSchedulerOptions, doAlarmScheduler } from "./alarm-scheduler.js";
export { type DoLockOptions, doLock } from "./do-lock.js";
export { type DoSqliteStoreOptions, doSqliteIndex, doSqliteStore } from "./do-sqlite-store.js";
export {
  type HibernatableWebSocketLike,
  type WebSocketHibernation,
  type WebSocketHibernationOptions,
  webSocketHibernation,
} from "./hibernation.js";
export { CLOUDFLARE_PLATFORM_HINT, type SecretsStoreSecretLike, workerKeyStore } from "./key-store.js";
export type { DurableStorageLike, SqlCursorLike, SqlDurableStorageLike, SqlStorageLike } from "./storage.js";
