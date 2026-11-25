// The AWS target's factories for the portability suite: each seam's adapter on an in-process fake of its AWS service.
import { randomBytes } from "node:crypto";
import { dynamoEffectStore } from "@buildanagent/agent-safety/stores/dynamodb";
import { dynamoLock, dynamoStore } from "@buildanagent/harness/aws/dynamodb";
import { deliverWake, eventBridgeScheduler } from "@buildanagent/harness/aws/scheduler";
import { secretsManagerKeyStore } from "@buildanagent/harness/aws/secrets-manager";
import { processScheduler } from "@buildanagent/harness/session";
import type {
  DeliveredWake,
  KeyStoreFactory,
  LockFactory,
  PortabilityTarget,
  SchedulerFactory,
  StoreFactory,
} from "@buildanagent/harness/testing";
import { fakeDynamoDb } from "./fake-dynamodb.js";
import { fakeScheduler } from "./fake-scheduler.js";
import { fakeSecretsManager } from "./fake-secrets-manager.js";

export const START = Date.parse("2026-11-24T00:00:00.000Z");
export const TABLE = "harness-sessions";
export const RUNNER_ARN = "arn:aws:lambda:us-east-1:000000000000:function:runner";
export const ROLE_ARN = "arn:aws:iam::000000000000:role/scheduler-invokes-runner";
export const SECRET_ID = "buildanagent/approval-keys";

/** A ring of one random 256-bit key, as the owner would put it in the secret. */
export function ringText(id = "2026-11"): string {
  return JSON.stringify({ current: id, keys: { [id]: randomBytes(32).toString("base64url") } });
}

const storeFactory: StoreFactory = () => ({ store: dynamoStore(fakeDynamoDb().client, { tableName: TABLE }) });

const lockFactory: LockFactory = () => {
  const { client } = fakeDynamoDb();
  let time = START;
  const leaseMs = 2_000;
  // No timer runs, so moving the clock past the lease lets the peer's lease lapse without a renewal.
  const quiet = processScheduler({ now: () => time, setTimer: () => 0, clearTimer: () => undefined });
  const options = { tableName: TABLE, leaseMs, renewMs: 500, maxClockSkewMs: 100, now: () => time, scheduler: quiet };
  return {
    lock: dynamoLock(client, options),
    lease: {
      peer: dynamoLock(client, options),
      leaseMs,
      staleness: "lease_only",
      advanceClock: (ms) => {
        time += ms;
      },
    },
  };
};

/** Lets every promise chain and timer callback the last step started run to the end. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * The scheduler on a fake EventBridge Scheduler and a clock the suite moves. A due schedule invokes the runner, which
 * here is `deliverWake()`; the fake fires a schedule at the start of its minute, so `deliverWake()` holds the wake
 * back on a timer of this clock until its time.
 */
export const schedulerFactory: SchedulerFactory = () => {
  let time = START;
  const timers: { at: number; resolve: () => void }[] = [];
  const delivered: DeliveredWake[] = [];
  const fake = fakeScheduler({ now: () => time });
  const scheduler = eventBridgeScheduler(fake.client, {
    targetArn: RUNNER_ARN,
    roleArn: ROLE_ARN,
    groupName: "harness-wakes",
    now: () => time,
  });
  const invoke = (input: string) => {
    void deliverWake(
      JSON.parse(input),
      (sessionId, at) => {
        delivered.push({ sessionId, at });
      },
      { now: () => time, sleep: (ms) => new Promise((resolve) => timers.push({ at: time + ms, resolve })) },
    );
  };
  return {
    scheduler,
    now: () => new Date(time),
    delivered: () => [...delivered],
    async advanceTo(to) {
      const target = to.getTime();
      for (;;) {
        await fake.fireDue(time, invoke);
        await settle();
        const next = Math.min(fake.nextDue() ?? Number.POSITIVE_INFINITY, ...timers.map((timer) => timer.at));
        if (next > target) break;
        time = Math.max(time, next);
        for (const timer of timers.filter((t) => t.at <= time)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.resolve();
        }
        await settle();
      }
      time = Math.max(time, target);
    },
  };
};

const keyStoreFactory: KeyStoreFactory = () => {
  const secrets = fakeSecretsManager();
  secrets.put(SECRET_ID, { SecretString: ringText() });
  return { store: secretsManagerKeyStore(secrets.client, { secretId: SECRET_ID }) };
};

/** The five seams N47a and agent-safety's DynamoDB store cover on AWS; the sandbox, egress and transport come later. */
export const AWS_TARGET: PortabilityTarget = {
  store: storeFactory,
  lock: lockFactory,
  scheduler: schedulerFactory,
  keyStore: keyStoreFactory,
  effectStore: () => dynamoEffectStore(fakeDynamoDb().client, { tableName: "harness-effects" }),
};
