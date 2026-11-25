// The opt-in live run of the AWS adapters against the owner's own account (todo N47a). It runs the portability suite's
// store, lock and key store cases against a real DynamoDB table and a real Secrets Manager secret, and checks that a
// wake becomes an EventBridge Scheduler schedule and that a cancel removes it. It never runs in CI or in `pnpm test`.
//
//   pnpm --filter "@buildanagent/harness..." build
//   HARNESS_AWS_LIVE=1 HARNESS_AWS_TABLE=... HARNESS_AWS_SECRET_ID=... \
//     HARNESS_AWS_SCHEDULER_TARGET_ARN=... HARNESS_AWS_SCHEDULER_ROLE_ARN=... \
//     node packages/harness/scripts/aws-live.mjs
//
// The AWS SDK finds credentials and the region the usual way (AWS_PROFILE, AWS_REGION and the rest). The script reads
// the secret only through the key store, prints case names, verdicts and error messages, and never prints a value it
// read from AWS. Every item it writes is under a namespace of its own run, and it deletes them at the end.
import { randomUUID } from "node:crypto";
import process from "node:process";

const REQUIRED = [
  "HARNESS_AWS_TABLE",
  "HARNESS_AWS_SECRET_ID",
  "HARNESS_AWS_SCHEDULER_TARGET_ARN",
  "HARNESS_AWS_SCHEDULER_ROLE_ARN",
];

function refuse(message) {
  console.error(`aws-live: ${message}`);
  process.exit(2);
}

if (process.env.HARNESS_AWS_LIVE !== "1") refuse("set HARNESS_AWS_LIVE=1 to run against your AWS account");
if (process.env.CI !== undefined) refuse("the live run never runs in CI");
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) refuse(`set ${missing.join(", ")}`);

// Loaded only once the run is allowed, so a refusal needs neither a build nor the AWS SDK.
const { BatchWriteItemCommand, DynamoDBClient, ScanCommand } = await import("@aws-sdk/client-dynamodb");
const { GetScheduleCommand, SchedulerClient } = await import("@aws-sdk/client-scheduler");
const { SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");
const { dynamoLock, dynamoStore } = await import("@buildanagent/harness/aws/dynamodb");
const { eventBridgeScheduler } = await import("@buildanagent/harness/aws/scheduler");
const { secretsManagerKeyStore } = await import("@buildanagent/harness/aws/secrets-manager");
const { processScheduler } = await import("@buildanagent/harness/session");
const { runPortabilityConformance } = await import("@buildanagent/harness/testing");

const env = process.env;
const table = env.HARNESS_AWS_TABLE;
const run = `live-${randomUUID().slice(0, 8)}`;
const dynamo = new DynamoDBClient({});
let cases = 0;
const namespace = () => `${run}-${cases++}`;

const leaseMs = 4_000;
let offset = 0;
// The lock's clock is the host's clock plus an offset the lease case moves, so the lease lapses without a wait.
const now = () => Date.now() + offset;
const quiet = processScheduler({ now, setTimer: () => 0, clearTimer: () => undefined });

const report = await runPortabilityConformance({
  store: () => ({ store: dynamoStore(dynamo, { tableName: table, namespace: namespace() }) }),
  lock: () => {
    const options = { tableName: table, namespace: namespace(), leaseMs, renewMs: 1_000, now, scheduler: quiet };
    return {
      lock: dynamoLock(dynamo, options),
      lease: {
        peer: dynamoLock(dynamo, options),
        leaseMs,
        staleness: "lease_only",
        advanceClock: (ms) => {
          offset += ms;
        },
      },
    };
  },
  keyStore: () => ({
    store: secretsManagerKeyStore(new SecretsManagerClient({}), { secretId: env.HARNESS_AWS_SECRET_ID }),
  }),
});

let passed = report.passed.length;
let failed = report.failed.length;
for (const { name } of report.passed) console.log(`pass  ${name}`);
for (const { name, reason } of report.skipped) console.log(`skip  ${name} (${reason})`);
for (const { name, error } of report.failed) console.log(`FAIL  ${name}: ${error}`);

// The scheduler: a wake two minutes ahead is one schedule with the expected expression, a second ask is the same one,
// and a cancel removes it before it fires.
const groupName = env.HARNESS_AWS_SCHEDULER_GROUP || "default";
const schedulerClient = new SchedulerClient({});
const scheduler = eventBridgeScheduler(schedulerClient, {
  targetArn: env.HARNESS_AWS_SCHEDULER_TARGET_ARN,
  roleArn: env.HARNESS_AWS_SCHEDULER_ROLE_ARN,
  groupName,
});
const sessionId = `${run}-wake`;
const at = new Date(Math.ceil((Date.now() + 120_000) / 1_000) * 1_000);
try {
  await scheduler.wake(at, sessionId);
  await scheduler.wake(at, sessionId);
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId)))
    .subarray(0, 16)
    .toString("hex");
  const name = `${hash}-${at.getTime()}`;
  const schedule = await schedulerClient.send(new GetScheduleCommand({ Name: name, GroupName: groupName }));
  const expected = `at(${at.toISOString().slice(0, 19)})`;
  if (schedule.ScheduleExpression !== expected) throw new Error(`the schedule's expression is not ${expected}`);
  if (schedule.ActionAfterCompletion !== "DELETE") throw new Error("the schedule does not delete itself");
  await scheduler.cancel(sessionId);
  const gone = await schedulerClient.send(new GetScheduleCommand({ Name: name, GroupName: groupName })).then(
    () => false,
    (error) => error?.name === "ResourceNotFoundException",
  );
  if (!gone) throw new Error("the cancel left the schedule in place");
  passed += 1;
  console.log("pass  scheduler: a wake is one self-deleting one-time schedule, and a cancel removes it");
} catch (error) {
  failed += 1;
  console.log(`FAIL  scheduler: ${error instanceof Error ? error.message : error}`);
  await scheduler.cancel(sessionId).catch(() => undefined);
}

/** Deletes every item under this run's namespaces, which no other run shares, and returns how many it found. */
async function cleanUp() {
  let found = 0;
  let start;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "begins_with(#pk, :run)",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: { ":run": { S: `n#${run}-` } },
        ProjectionExpression: "#pk, #sk",
        ExclusiveStartKey: start,
      }),
    );
    const keys = page.Items ?? [];
    found += keys.length;
    for (let i = 0; i < keys.length; i += 25) {
      let pending = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      for (let attempt = 0; pending.length > 0 && attempt < 8; attempt += 1) {
        const out = await dynamo.send(new BatchWriteItemCommand({ RequestItems: { [table]: pending } }));
        pending = out.UnprocessedItems?.[table] ?? [];
      }
    }
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return found;
}

const removed = await cleanUp().then(
  (count) => `removed the ${count} items of run ${run}`,
  (error) =>
    `could not remove the items of run ${run}: ${error?.name ?? "error"}; delete keys starting n#${run}- by hand`,
);
console.log(`\n${passed} passed, ${report.skipped.length} skipped, ${failed} failed; ${removed}`);
process.exit(failed === 0 ? 0 : 1);
