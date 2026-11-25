// The harness's state on Vercel: the session log, its writer lock and the pending wakes in one Postgres database, and
// the approval key ring in a secret environment variable. On Vercel, pass a pooled client such as `pg`'s
// `new Pool({ connectionString: process.env.DATABASE_URL })`.

import {
  createPostgresHarnessTables,
  envKeyStore,
  type PgClientLike,
  postgresLock,
  postgresStore,
  postgresWakeLedger,
} from "@buildanagent/harness/vercel";

const LEASE_MS = 30_000;

/** Creates the tables if they are missing and returns the four state seams over `client`. */
export async function vercelState(client: PgClientLike, env?: Readonly<Record<string, string | undefined>>) {
  await createPostgresHarnessTables(client);
  return {
    store: postgresStore(client),
    lock: postgresLock(client, { leaseMs: LEASE_MS }),
    ledger: postgresWakeLedger(client),
    keyStore: envKeyStore({ name: "HARNESS_KEY_RING", ...(env === undefined ? {} : { env }) }),
  };
}
