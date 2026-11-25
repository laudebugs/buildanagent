// Runs the AWS example on the in-process fakes: a wake the scheduler created reaches the handler, which takes the
// session's lock, resumes it from the DynamoDB log and lets the lock go; a wake that meets the lock held asks for
// another wake after the lease instead of being dropped.
import assert from "node:assert/strict";
import { test } from "vitest";
import { awsSeams, wakeHandler, wakeId } from "../../examples/aws-runner.js";
import { ROLE_ARN, RUNNER_ARN, ringText, SECRET_ID, TABLE } from "../aws/aws-target.js";
import { fakeDynamoDb } from "../aws/fake-dynamodb.js";
import { fakeScheduler } from "../aws/fake-scheduler.js";
import { fakeSecretsManager } from "../aws/fake-secrets-manager.js";

test("a wake resumes its session under the session's lock, and one that meets the lock held asks for a later wake", async () => {
  const secrets = fakeSecretsManager();
  secrets.put(SECRET_ID, { SecretString: ringText() });
  const scheduler = fakeScheduler({ now: () => Date.now() });
  const seams = awsSeams(
    { dynamo: fakeDynamoDb().client, scheduler: scheduler.client, secrets: secrets.client },
    { table: TABLE, runnerArn: RUNNER_ARN, schedulerRoleArn: ROLE_ARN, keySecretId: SECRET_ID },
  );
  const key = { userId: "ada", sessionId: "s1" };
  await seams.store.append(key, [
    {
      id: "h1",
      parentId: null,
      timestamp: "2026-11-24T00:00:00.000Z",
      origin: "harness",
      type: "session_header",
      formatVersion: 1,
      harnessVersion: "0.0.0",
      sdkVersion: "0.0.0",
      defaultsHash: "d",
      capabilities: [],
      ablationHash: "a",
    },
  ]);
  assert.equal((await seams.keys.load()).current, "2026-11");

  const resumed: string[] = [];
  let duplicate: Promise<void> | undefined;
  const handler = wakeHandler(seams, async (resuming) => {
    for await (const entry of seams.store.load(resuming)) resumed.push(entry.id);
    // The same wake arrives again while this one runs, as an at-least-once delivery may.
    duplicate ??= handler(JSON.parse(scheduler.schedules()[0]?.input ?? "{}"));
  });
  await seams.scheduler.wake(new Date(Date.now() - 1_000), wakeId(key));
  const [schedule] = scheduler.schedules();
  await handler(JSON.parse(schedule?.input ?? "{}"));
  await duplicate;
  assert.deepEqual(resumed, ["h1"], "the session resumed once");
  const later = scheduler.schedules().map((s) => JSON.parse(s.input));
  assert.equal(later.length, 2, "the blocked wake asked for one more");
  assert.ok(Date.parse(later[1].at) >= Date.now() + 30_000, "the new wake comes after the lock's 30-second lease");
  assert.notEqual(await seams.lock.acquire(key), "would_block", "the lock was released");
});
