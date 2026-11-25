// What the EventBridge Scheduler adapter sends, how a runner delivers its wakes and how a cancel pages.
import assert from "node:assert/strict";
import { DeleteScheduleCommand, type SchedulerClient } from "@aws-sdk/client-scheduler";
import {
  deliverWake,
  eventBridgeScheduler,
  parseWakeEvent,
  WAKE_EVENT_TYPE,
} from "@buildanagent/harness/aws/scheduler";
import { describe, test } from "vitest";
import { ROLE_ARN, RUNNER_ARN, START } from "./aws-target.js";
import { fakeScheduler } from "./fake-scheduler.js";

const options = { targetArn: RUNNER_ARN, roleArn: ROLE_ARN, groupName: "harness-wakes" };

describe("eventBridgeScheduler", () => {
  test("a wake is a one-time UTC schedule, rounded up to the second, that deletes itself and carries the exact time", async () => {
    const fake = fakeScheduler({ now: () => START });
    const scheduler = eventBridgeScheduler(fake.client, { ...options, now: () => START });
    await scheduler.wake(new Date(START + 90_250), "s1");
    const [create] = fake.sent;
    assert.equal(create?.operation, "CreateSchedule");
    const { Name, Target, ...rest } = create?.input ?? {};
    assert.match(Name, /^[0-9a-f]{32}-1795478490250$/, "the name is a hash of the id and the wake's time");
    assert.ok(!String(Name).includes("s1"));
    assert.deepEqual(rest, {
      GroupName: "harness-wakes",
      ScheduleExpression: "at(2026-11-24T00:01:31)",
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      ActionAfterCompletion: "DELETE",
    });
    assert.deepEqual(
      { Arn: Target.Arn, RoleArn: Target.RoleArn, Input: JSON.parse(Target.Input) },
      {
        Arn: RUNNER_ARN,
        RoleArn: ROLE_ARN,
        Input: { type: WAKE_EVENT_TYPE, version: 1, sessionId: "s1", at: "2026-11-24T00:01:30.250Z" },
      },
    );
  });

  test("a wake whose time has passed or is under five seconds off goes five seconds ahead, and keeps the time asked for", async () => {
    const now = START + 400;
    const fake = fakeScheduler({ now: () => now });
    const scheduler = eventBridgeScheduler(fake.client, { ...options, now: () => now });
    await scheduler.wake(new Date(START - 60_000), "s1");
    // Five seconds covers request latency and a host clock behind AWS's, so the service never meets a past time.
    assert.equal(fake.sent[0]?.input.ScheduleExpression, "at(2026-11-24T00:00:06)");
    await scheduler.wake(new Date(START + 2_000), "s1");
    assert.equal(fake.sent[1]?.input.ScheduleExpression, "at(2026-11-24T00:00:06)");
    assert.equal(JSON.parse(fake.sent[0]?.input.Target.Input).at, "2026-11-23T23:59:00.000Z");
  });

  test("asking twice for one id and time is one schedule, and a dead-letter queue goes on the target", async () => {
    const fake = fakeScheduler({ now: () => START });
    const dlq = "arn:aws:sqs:us-east-1:000000000000:wakes-dlq";
    const scheduler = eventBridgeScheduler(fake.client, { ...options, deadLetterArn: dlq, now: () => START });
    await scheduler.wake(new Date(START + 5_000), "s1");
    await scheduler.wake(new Date(START + 5_000), "s1");
    assert.equal(fake.schedules().length, 1);
    assert.deepEqual(fake.sent[0]?.input.Target.DeadLetterConfig, { Arn: dlq });
  });

  test("cancel pages through the session's schedules, leaves other sessions' and ignores one that already ran", async () => {
    const fake = fakeScheduler({ now: () => START, pageSize: 2 });
    let deletedByService = false;
    // One schedule runs and deletes itself between the list and the cancel's delete.
    const client = {
      send: async (command: { input: { Name?: string } }) => {
        if (command instanceof DeleteScheduleCommand && !deletedByService) {
          deletedByService = true;
          await fake.client.send(new DeleteScheduleCommand({ Name: command.input.Name, GroupName: "harness-wakes" }));
        }
        return fake.client.send(command as never);
      },
    } as unknown as SchedulerClient;
    const scheduler = eventBridgeScheduler(client, { ...options, now: () => START });
    for (let i = 1; i <= 5; i += 1) await scheduler.wake(new Date(START + i * 1_000), "gone");
    await scheduler.wake(new Date(START + 1_000), "kept");
    await scheduler.cancel("gone");
    assert.equal(fake.schedules().length, 1);
    assert.equal(JSON.parse(fake.schedules()[0]?.input ?? "{}").sessionId, "kept");
    assert.ok(fake.sent.filter((s) => s.operation === "ListSchedules").length >= 3, "the list was read page by page");
    await scheduler.cancel("never-asked");
  });

  test("refuses a missing client, a target or role that is not an ARN and a group name the service would refuse", () => {
    const { client } = fakeScheduler({ now: () => START });
    const code = { code: "invalid_aws_options" };
    assert.throws(() => eventBridgeScheduler(undefined as never, options), code);
    assert.throws(() => eventBridgeScheduler(client, { ...options, targetArn: "runner" }), code);
    assert.throws(() => eventBridgeScheduler(client, { ...options, roleArn: "" }), code);
    assert.throws(() => eventBridgeScheduler(client, { ...options, groupName: "has space" }), code);
    assert.throws(() => eventBridgeScheduler(client, { ...options, deadLetterArn: "queue" }), code);
  });
});

describe("deliverWake", () => {
  const event = (at: number) => ({
    type: WAKE_EVENT_TYPE,
    version: 1,
    sessionId: "s1",
    at: new Date(at).toISOString(),
  });

  test("a wake that arrives up to a minute early waits until its time, and a late one is delivered at once", async () => {
    let time = START;
    const slept: number[] = [];
    const seen: [string, number][] = [];
    const handler = (sessionId: string, at: Date) => {
      seen.push([sessionId, at.getTime()]);
    };
    const sleep = async (ms: number) => {
      slept.push(ms);
      time += ms;
    };
    await deliverWake(event(START + 59_000), handler, { now: () => time, sleep });
    assert.deepEqual(slept, [59_000]);
    assert.equal(time, START + 59_000, "the handler ran only once the wake's time had come");
    await deliverWake(JSON.stringify(event(START)), handler, { now: () => time, sleep });
    assert.deepEqual(slept, [59_000], "a late wake does not wait");
    assert.deepEqual(seen, [
      ["s1", START + 59_000],
      ["s1", START],
    ]);
  });

  test("a wake further ahead than any schedule fires early is refused", async () => {
    await assert.rejects(
      () => deliverWake(event(START + 71_000), () => assert.fail("must not run"), { now: () => START }),
      { code: "invalid_wake_event" },
    );
  });

  test("a maxEarlyMs that is not a finite number of at least 0 is refused, so NaN can't turn the early check off", async () => {
    for (const maxEarlyMs of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        () =>
          deliverWake(event(START + 3_600_000), () => assert.fail("must not run"), { now: () => START, maxEarlyMs }),
        { code: "invalid_aws_options" },
      );
    }
  });

  test("an event that is not a wake is refused without quoting it", () => {
    for (const bad of [
      "not json {secret-ish}",
      null,
      { type: "other", version: 1, sessionId: "s1", at: "2026-11-24T00:00:00Z" },
      { type: WAKE_EVENT_TYPE, version: 1, sessionId: "", at: "2026-11-24T00:00:00Z" },
      { type: WAKE_EVENT_TYPE, version: 1, sessionId: "s1", at: "soon" },
    ]) {
      assert.throws(
        () => parseWakeEvent(bad),
        (error: Error & { code?: string }) =>
          error.code === "invalid_wake_event" && !error.message.includes("secret-ish"),
      );
    }
    assert.deepEqual(parseWakeEvent(event(START)), { sessionId: "s1", at: new Date(START) });
  });
});
