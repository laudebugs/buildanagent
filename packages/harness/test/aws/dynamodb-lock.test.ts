// What the DynamoDB lock does beyond the shared suite: renewal, the fence, clock skew, a lost response and its requests.
import assert from "node:assert/strict";
import { type DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { type DynamoLockHandle, dynamoLock } from "@buildanagent/harness/aws/dynamodb";
import { processScheduler } from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { START, TABLE } from "./aws-target.js";
import { fakeDynamoDb } from "./fake-dynamodb.js";

const KEY = { userId: "ada", sessionId: "s1" };

/** A lock on a clock and timers the test moves by hand. */
function manual(dynamo = fakeDynamoDb(), client: DynamoDBClient = dynamo.client) {
  let time = START;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let next = 0;
  const scheduler = processScheduler({
    now: () => time,
    setTimer: (callback, ms) => {
      timers.set(next, { at: time + ms, callback });
      return next++;
    },
    clearTimer: (timer) => {
      timers.delete(timer as number);
    },
  });
  const options = { tableName: TABLE, leaseMs: 3_000, renewMs: 1_000, maxClockSkewMs: 500, now: () => time, scheduler };
  return {
    dynamo,
    lock: dynamoLock(client, options),
    other: dynamoLock(client, options),
    /** Moves the clock and runs the timers that came due, letting each renewal's request settle. */
    async advance(ms: number) {
      const target = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        time = Math.max(time, due[1].at);
        due[1].callback();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      time = target;
    },
  };
}

const hold = (acquired: unknown) => {
  assert.notEqual(acquired, "would_block");
  return acquired as DynamoLockHandle;
};

describe("dynamoLock", () => {
  test("the holder renews its lease, so another writer stays blocked long after the first lease would have lapsed", async () => {
    const { lock, other, advance } = manual();
    const first = hold(await lock.acquire(KEY));
    await advance(10_000);
    assert.equal(first.held(), true);
    assert.equal(await other.acquire(KEY), "would_block");
    await first.release();
    hold(await other.acquire(KEY));
  });

  test("held() turns false before the lease ends on the holder's clock, by the allowed clock skew", async () => {
    let time = START;
    const quiet = processScheduler({ now: () => time, setTimer: () => 0, clearTimer: () => undefined });
    const lock = dynamoLock(fakeDynamoDb().client, {
      tableName: TABLE,
      leaseMs: 3_000,
      renewMs: 1_000,
      maxClockSkewMs: 500,
      now: () => time,
      scheduler: quiet,
    });
    const handle = hold(await lock.acquire(KEY));
    time += 2_499;
    assert.equal(handle.held(), true);
    time += 1;
    assert.equal(handle.held(), false, "a peer whose clock runs 500 ms ahead may take the lease now");
  });

  test("a holder whose lease was taken over finds another token at its next renewal and stops", async () => {
    const { lock, dynamo, advance } = manual();
    const handle = hold(await lock.acquire(KEY));
    // Another host took the lapsed lease while this holder was paused, as a frozen Lambda would be.
    const item = dynamo.items(TABLE).find((entry) => entry.sk?.S === "l#s1");
    dynamo.put(TABLE, { ...item, token: { S: "the-successor" }, leaseUntil: { N: String(START + 60_000) } } as never);
    assert.equal(handle.held(), true, "the holder can't know until it renews");
    await advance(1_000);
    assert.equal(handle.held(), false, "the renewal met another token, so the holder stops");
    await handle.release();
    const after = dynamo.items(TABLE).find((entry) => entry.sk?.S === "l#s1");
    assert.equal(after?.token?.S, "the-successor", "the stale release left the successor's lease alone");
  });

  test("the fence grows with every acquire and survives a release, because the item is kept", async () => {
    const { lock, dynamo } = manual();
    const fences: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const handle = hold(await lock.acquire(KEY));
      fences.push(handle.fence);
      await handle.release();
    }
    assert.deepEqual(fences, [1, 2, 3]);
    const item = dynamo.items(TABLE).find((entry) => entry.sk?.S === "l#s1");
    assert.equal(item?.token, undefined, "a released item holds no token");
    assert.equal(item?.leaseUntil?.N, "0");
  });

  test("an acquire whose response was lost is recognised as this acquire's own when the SDK resends it", async () => {
    const { lock, other, dynamo } = manual();
    dynamo.loseNextResponse("UpdateItem");
    const handle = hold(await lock.acquire(KEY));
    assert.equal(handle.fence, 1);
    assert.equal(await other.acquire(KEY), "would_block");
  });

  test("acquire, renew and release are each one conditional update", async () => {
    const dynamo = fakeDynamoDb();
    const sent: { ConditionExpression?: string; UpdateExpression?: string }[] = [];
    const recording = {
      send: (command: { input: (typeof sent)[number] }) => {
        if (command instanceof UpdateItemCommand) sent.push(command.input);
        return dynamo.client.send(command as never);
      },
    } as unknown as DynamoDBClient;
    const { lock, advance } = manual(dynamo, recording);
    const handle = hold(await lock.acquire(KEY));
    await advance(1_000);
    await handle.release();
    assert.deepEqual(
      sent.map((input) => [input.UpdateExpression, input.ConditionExpression]),
      [
        [
          "SET #token = :token, #leaseUntil = :until ADD #fence :one",
          "attribute_not_exists(#sk) OR #leaseUntil < :now",
        ],
        ["SET #leaseUntil = :until", "#token = :token"],
        ["SET #leaseUntil = :zero REMOVE #token", "#token = :token"],
      ],
    );
  });

  test("refuses a lease that the renewal interval and the clock skew don't fit in", () => {
    const { client } = fakeDynamoDb();
    const code = { code: "invalid_lock_options" };
    assert.throws(
      () => dynamoLock(client, { tableName: TABLE, leaseMs: 1_000, renewMs: 600, maxClockSkewMs: 400 }),
      code,
    );
    assert.throws(() => dynamoLock(client, { tableName: TABLE, leaseMs: 0 }), code);
    assert.throws(() => dynamoLock(client, { tableName: "x" }), { code: "invalid_aws_options" });
    dynamoLock(client, { tableName: TABLE });
  });
});
