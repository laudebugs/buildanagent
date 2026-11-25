/**
 * `@buildanagent/harness/aws/scheduler`: the `Scheduler` seam on Amazon EventBridge Scheduler. Each wake is a one-time
 * schedule that invokes the host's runner, such as a Lambda function, with the wake as its input, and deletes itself
 * once it has run. `deliverWake()` is the runner's side: it reads the input and calls the host's handler, never before
 * the wake's time.
 *
 * @module @buildanagent/harness/aws/scheduler
 */
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ListSchedulesCommand,
  type SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { HarnessError } from "../errors.js";
import type { Scheduler, WakeHandler } from "../session/scheduler.js";
import { checkClient, errorName } from "./sdk.js";

/** The `type` field of a wake's input, so a runner that takes other events can tell a wake apart. */
export const WAKE_EVENT_TYPE = "buildanagent.wake";

/** The input each schedule sends its target: the session id and the time the wake was asked for. */
export interface WakeEvent {
  readonly type: typeof WAKE_EVENT_TYPE;
  readonly version: 1;
  readonly sessionId: string;
  /** The time the wake was asked for, as an ISO 8601 string. */
  readonly at: string;
}

/** The options of `eventBridgeScheduler()`. */
export interface EventBridgeSchedulerOptions {
  /** The ARN of what each schedule invokes, such as the runner's Lambda function. */
  readonly targetArn: string;
  /** The ARN of the role EventBridge Scheduler assumes to invoke the target. */
  readonly roleArn: string;
  /** The schedule group the wakes go in. Default `default`. A group of its own keeps the wakes apart from other schedules. */
  readonly groupName?: string;
  /** The ARN of an SQS queue that receives a wake whose every invocation failed. Default: none. */
  readonly deadLetterArn?: string;
  /** The clock, in milliseconds since the epoch. Default `Date.now`. */
  readonly now?: () => number;
}

// EventBridge Scheduler's rule for a schedule or group name: 1 to 64 of these characters.
const NAME = /^[0-9a-zA-Z_.-]{1,64}$/;
const SECOND = 1_000;
// How far ahead of this host's clock a schedule for a past or present time is set, so request latency and a host
// clock a few seconds behind AWS's never send a time the service already sees as past.
const PAST_MARGIN_MS = 5_000;

const invalid = (message: string) => new HarnessError("invalid_aws_options", `eventBridgeScheduler() ${message}`);

/** The first 128 bits of the SHA-256 of `text`, in hex, which names a session's schedules and holds no part of its id. */
async function digest(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** An `at()` expression in UTC, to the second, as EventBridge Scheduler reads one. */
function atExpression(ms: number): string {
  return `at(${new Date(ms).toISOString().slice(0, 19)})`;
}

/**
 * A `Scheduler` whose wakes are EventBridge Scheduler one-time schedules. `wake(at, sessionId)` creates a schedule
 * named from a hash of the session id and the wake's time, so asking twice for the same id and time is one wake. The
 * schedule's `at()` expression is `at` rounded up to the second, or five seconds from now when that is sooner, so a
 * wake in the past arrives at once and the service never meets a time it sees as past. Its input is a `WakeEvent` that
 * carries the exact time asked for, its flexible time window is off, and it deletes itself after it runs.
 * `cancel(sessionId)` lists the group's schedules whose names start with that id's hash and deletes each one, so a
 * schedule that already ran and deleted itself is no error.
 *
 * EventBridge Scheduler invokes a target within the minute its expression names, so a wake can reach the runner up to
 * 59 seconds before its `at()` second and up to a minute after it. `deliverWake()` holds an early wake back until its
 * time. A wake is at-least-once, as the seam allows: a retried invocation, or a wake that a cancel lists too late to
 * delete, arrives again, and the handler treats it as harmless.
 */
export function eventBridgeScheduler(client: SchedulerClient, options: EventBridgeSchedulerOptions): Scheduler {
  checkClient("eventBridgeScheduler()", client);
  const settings = checkOptions(options);
  return {
    wake: (at, sessionId) => createWake(client, settings, at, sessionId),
    cancel: (sessionId) => cancelWakes(client, settings, sessionId),
  };
}

interface Settings {
  readonly targetArn: string;
  readonly roleArn: string;
  readonly groupName: string;
  readonly deadLetterArn: string | undefined;
  readonly now: () => number;
}

const isArn = (value: unknown) => typeof value === "string" && value.startsWith("arn:");

function checkOptions(options: EventBridgeSchedulerOptions): Settings {
  const { targetArn, roleArn, deadLetterArn } = options ?? {};
  const groupName = options?.groupName ?? "default";
  if (!isArn(targetArn)) throw invalid("needs targetArn to be an ARN");
  if (!isArn(roleArn)) throw invalid("needs roleArn to be an ARN");
  if (deadLetterArn !== undefined && !isArn(deadLetterArn))
    throw invalid("needs deadLetterArn to be an ARN when given");
  if (!NAME.test(groupName)) throw invalid("needs a groupName of 1 to 64 letters, digits, _, . or -");
  return { targetArn, roleArn, groupName, deadLetterArn, now: options.now ?? Date.now };
}

async function createWake(client: SchedulerClient, settings: Settings, at: Date, sessionId: string): Promise<void> {
  const time = at.getTime();
  if (Number.isNaN(time)) throw new TypeError("Scheduler.wake needs a valid date.");
  if (typeof sessionId !== "string" || sessionId === "") throw new TypeError("Scheduler.wake needs a session id.");
  // EventBridge Scheduler reads whole seconds, and a time that has passed, or is about to, goes a margin ahead.
  const fireAt = Math.ceil(Math.max(time, settings.now() + PAST_MARGIN_MS) / SECOND) * SECOND;
  const input: WakeEvent = { type: WAKE_EVENT_TYPE, version: 1, sessionId, at: new Date(time).toISOString() };
  const { targetArn, roleArn, groupName, deadLetterArn } = settings;
  try {
    await client.send(
      new CreateScheduleCommand({
        Name: `${await digest(sessionId)}-${time}`,
        GroupName: groupName,
        ScheduleExpression: atExpression(fireAt),
        ScheduleExpressionTimezone: "UTC",
        FlexibleTimeWindow: { Mode: "OFF" },
        ActionAfterCompletion: "DELETE",
        Target: {
          Arn: targetArn,
          RoleArn: roleArn,
          Input: JSON.stringify(input),
          ...(deadLetterArn === undefined ? {} : { DeadLetterConfig: { Arn: deadLetterArn } }),
        },
      }),
    );
  } catch (error) {
    // A schedule of this name exists, so this id and time already have their wake.
    if (errorName(error) !== "ConflictException") throw error;
  }
}

/** The names of every schedule in the group whose name starts with `prefix`, read page by page. */
async function namesWith(client: SchedulerClient, groupName: string, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListSchedulesCommand({ GroupName: groupName, NamePrefix: prefix, NextToken: token }),
    );
    for (const schedule of page.Schedules ?? []) if (schedule.Name !== undefined) names.push(schedule.Name);
    token = page.NextToken;
  } while (token !== undefined);
  return names;
}

async function cancelWakes(client: SchedulerClient, settings: Settings, sessionId: string): Promise<void> {
  const { groupName } = settings;
  // Every page is read before anything is deleted, because a delete can move the schedules a page token points past.
  for (const name of await namesWith(client, groupName, `${await digest(sessionId)}-`)) {
    try {
      await client.send(new DeleteScheduleCommand({ Name: name, GroupName: groupName }));
    } catch (error) {
      // A schedule that ran in the meantime deleted itself.
      if (errorName(error) !== "ResourceNotFoundException") throw error;
    }
  }
}

const badEvent = (why: string) => new HarnessError("invalid_wake_event", `the event is not a wake: ${why}`);

/**
 * Reads a `WakeEvent` from what the target received: the event object a Lambda function is invoked with, or its JSON
 * text. Throws a `HarnessError`, code `invalid_wake_event`, for anything else, without quoting the event.
 */
export function parseWakeEvent(event: unknown): { readonly sessionId: string; readonly at: Date } {
  let value = event;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw badEvent("its text is not JSON");
    }
  }
  if (typeof value !== "object" || value === null) throw badEvent("it is not an object");
  const { type, version, sessionId, at } = value as Partial<Record<keyof WakeEvent, unknown>>;
  if (type !== WAKE_EVENT_TYPE || version !== 1) throw badEvent(`its type is not ${WAKE_EVENT_TYPE} version 1`);
  if (typeof sessionId !== "string" || sessionId === "") throw badEvent("it has no session id");
  const time = typeof at === "string" ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(time)) throw badEvent("its time is not an ISO 8601 date");
  return { sessionId, at: new Date(time) };
}

/** The options of `deliverWake()`. */
export interface DeliverWakeOptions {
  /** The clock, in milliseconds since the epoch. Default `Date.now`. */
  readonly now?: () => number;
  /** Waits `ms` milliseconds. Default a timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * The most a wake may arrive before its time and still be held back, in milliseconds. Default 70 seconds, which
   * covers EventBridge Scheduler's one-minute window and some clock skew. An earlier wake is refused.
   */
  readonly maxEarlyMs?: number;
}

const DEFAULT_MAX_EARLY_MS = 70_000;

/**
 * Delivers one wake to `handler`, never before its time on this host's clock. It reads the event with
 * `parseWakeEvent()`, waits until the wake's time when the event arrived early, and then calls the handler once with
 * the session id and the time asked for. A wake more than `maxEarlyMs` early is refused with `invalid_wake_event`,
 * because no schedule this adapter creates fires that early. The handler must be idempotent, because a wake can
 * arrive more than once. Give the runner a timeout longer than `maxEarlyMs` plus the handler's own work.
 */
export async function deliverWake(
  event: unknown,
  handler: WakeHandler,
  options: DeliverWakeOptions = {},
): Promise<void> {
  const { sessionId, at } = parseWakeEvent(event);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxEarlyMs = options.maxEarlyMs ?? DEFAULT_MAX_EARLY_MS;
  // A NaN would turn the refusal off, since no number is greater than NaN, and a negative bound would refuse on-time
  // wakes.
  if (!Number.isFinite(maxEarlyMs) || maxEarlyMs < 0) {
    throw new HarnessError(
      "invalid_aws_options",
      "deliverWake() needs a maxEarlyMs that is a finite number of at least 0",
    );
  }
  const early = at.getTime() - now();
  if (early > maxEarlyMs) throw badEvent(`it arrived ${early} ms before its time, more than ${maxEarlyMs} ms early`);
  // A sleep can end a little early, so the clock is read again until the wake's time has come.
  for (let wait = early; wait > 0; wait = at.getTime() - now()) await sleep(wait);
  await handler(sessionId, at);
}
