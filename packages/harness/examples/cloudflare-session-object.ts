// A Durable Object's agent server: the session log, its writer lock and its wakes live in the object's own SQLite
// storage, approvals are signed with the key ring in a Worker secret, and clients connect over hibernatable WebSockets.
import { hmacSigner } from "@buildanagent/agent-safety";
import type { Model } from "@buildanagent/gateway";
import {
  type DurableStorageLike,
  doAlarmScheduler,
  doLock,
  doSqliteIndex,
  doSqliteStore,
  type SecretsStoreSecretLike,
  webSocketHibernation,
  workerKeyStore,
} from "@buildanagent/harness/cloudflare";
import { createDispatcher, createHarness } from "@buildanagent/harness/server";
import { createToolRegistry } from "@buildanagent/harness/tools";

const SYSTEM = "You are a coding agent.";

/** What the object passes in: its `ctx.storage`, the key ring's secret, the model and whose sessions it serves. */
export interface SessionObjectOptions {
  readonly storage: DurableStorageLike;
  readonly keyRing: string | SecretsStoreSecretLike;
  readonly model: Model;
  readonly userId: string;
}

/** Builds the object's server once; the object forwards its WebSocket events to `sockets` and its alarm to `wakes`. */
export async function sessionObject(options: SessionObjectOptions) {
  const { storage, userId } = options;
  const signer = hmacSigner(await workerKeyStore(options.keyRing).load());
  const harness = createHarness({ registry: createToolRegistry(), model: options.model, system: SYSTEM, signer });
  const store = doSqliteStore(storage);
  const dispatcher = createDispatcher({ harness, store, index: doSqliteIndex(storage), lock: doLock(storage), userId });
  return { sockets: webSocketHibernation({ dispatcher }), wakes: doAlarmScheduler(storage) };
}
