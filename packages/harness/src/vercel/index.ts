/**
 * `@buildanagent/harness/vercel`: the harness's state seams for Vercel. `postgresStore()` and `postgresLock()` keep the
 * session log and its writer lock in Postgres, `workflowScheduler()` turns each wake into a Vercel Workflow run, and
 * `envKeyStore()` reads the approval key ring from a secret environment variable. Nothing here imports a Postgres
 * driver or the Workflow SDK: you pass the client and the SDK's functions in, so the entry loads in any runtime and
 * tests run on an in-process Postgres. The body of the wake run is in `@buildanagent/harness/vercel/workflow`.
 *
 * @module @buildanagent/harness/vercel
 */
export { DEFAULT_KEY_RING_VARIABLE, type EnvKeyStoreOptions, envKeyStore } from "./env-key-store.js";
export { type PostgresLockHandle, type PostgresLockOptions, postgresLock } from "./postgres-lock.js";
export { createPostgresHarnessTables, type PgClientLike, POSTGRES_HARNESS_SCHEMA } from "./postgres-schema.js";
export { type PostgresStoreOptions, postgresStore } from "./postgres-store.js";
export {
  type DeliverWakeOptions,
  deliverWake,
  postgresWakeLedger,
  type WakeLedger,
  type WorkflowSchedulerOptions,
  wakeToken,
  workflowScheduler,
} from "./wake.js";
export type { WakeRequest, WakeSignal } from "./workflow.js";
