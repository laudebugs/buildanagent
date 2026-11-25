// An in-process EventBridge Scheduler for the scheduler adapter's offline tests. It takes the SDK's real command
// objects, checks a CreateSchedule the way the service's API reference describes (a name of 1 to 64 of
// [0-9a-zA-Z-_.], an `at(yyyy-mm-ddThh:mm:ss)` expression, an input of at most 256 KB), refuses a second schedule of
// one name with a ConflictException, refuses an `at()` time that has passed, and pages ListSchedules. It runs on a
// clock the test moves: `fireDue(now)` invokes every schedule whose minute has begun, at the start of that minute,
// which is the earliest the documented 60-second precision allows, and deletes a schedule whose ActionAfterCompletion
// is DELETE.
import {
  ConflictException,
  type CreateScheduleCommandInput,
  type DeleteScheduleCommandInput,
  type ListSchedulesCommandInput,
  ResourceNotFoundException,
  type SchedulerClient,
  ValidationException,
} from "@aws-sdk/client-scheduler";

interface Schedule {
  readonly name: string;
  readonly group: string;
  readonly fireAt: number;
  readonly input: string;
  readonly deleteAfter: boolean;
  fired: boolean;
}

/** One request the fake received. */
export interface SentRequest {
  readonly operation: string;
  // The test reads the fields of each operation's input, so it is left untyped here.
  // biome-ignore lint/suspicious/noExplicitAny: a recorded request is read field by field in assertions.
  readonly input: any;
}

const NAME = /^[0-9a-zA-Z_.-]{1,64}$/;
const AT = /^at\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\)$/;
const MINUTE = 60_000;
const metadata = { httpStatusCode: 400 };
const minuteOf = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;

function invalid(message: string): never {
  throw new ValidationException({ message, Message: message, $metadata: metadata });
}

/** Refuses a CreateSchedule the service would refuse, or one the adapter should never send, and returns its time. */
function checkCreate(input: CreateScheduleCommandInput, now: number): number {
  if (!NAME.test(input.Name ?? "")) invalid("Name must match [0-9a-zA-Z-_.]+ and be 1 to 64 characters");
  const at = AT.exec(input.ScheduleExpression ?? "");
  if (at === null) return invalid("only one-time at() schedules are expected here");
  if (input.ScheduleExpressionTimezone !== "UTC") invalid("the adapter writes its times in UTC");
  if (input.FlexibleTimeWindow?.Mode !== "OFF") invalid("FlexibleTimeWindow is required");
  if (!input.Target?.Arn || !input.Target.RoleArn) invalid("Target needs Arn and RoleArn");
  if (new TextEncoder().encode(input.Target.Input ?? "").length > 256 * 1024) invalid("Input is over 256 KB");
  const fireAt = Date.parse(`${at[1]}Z`);
  // What the service does with a time that has passed is not documented, so the fake refuses it.
  if (fireAt < Math.floor(now / 1_000) * 1_000) invalid("the at() time has passed");
  return fireAt;
}

/** The fake, the client the adapter takes, and the means to fire what is due. */
export function fakeScheduler(options: { readonly pageSize?: number; readonly now: () => number }) {
  const pageSize = options.pageSize ?? 2;
  const schedules = new Map<string, Schedule>();
  const sent: SentRequest[] = [];
  const key = (group: string | undefined, name: string | undefined) => `${group ?? "default"}/${name}`;

  function create(input: CreateScheduleCommandInput) {
    const fireAt = checkCreate(input, options.now());
    const group = input.GroupName ?? "default";
    if (schedules.has(key(group, input.Name))) {
      const message = `Schedule ${input.Name} already exists.`;
      throw new ConflictException({ message, Message: message, $metadata: metadata });
    }
    schedules.set(key(group, input.Name), {
      name: String(input.Name),
      group,
      fireAt,
      input: String(input.Target?.Input),
      deleteAfter: input.ActionAfterCompletion === "DELETE",
      fired: false,
    });
    return { ScheduleArn: `arn:aws:scheduler:us-east-1:000000000000:schedule/${group}/${input.Name}` };
  }

  function remove(input: DeleteScheduleCommandInput) {
    if (!schedules.delete(key(input.GroupName, input.Name))) {
      throw new ResourceNotFoundException({ message: "Schedule not found", Message: "not found", $metadata: metadata });
    }
    return {};
  }

  function list(input: ListSchedulesCommandInput) {
    const group = input.GroupName ?? "default";
    const names = [...schedules.values()]
      .filter((s) => s.group === group && s.name.startsWith(input.NamePrefix ?? ""))
      .map((s) => s.name)
      .sort();
    // An offset, which a delete between pages shifts: the adapter must read every page before it deletes.
    const start = input.NextToken === undefined ? 0 : Number(input.NextToken);
    const page = names.slice(start, start + pageSize);
    return {
      Schedules: page.map((name) => ({ Name: name, GroupName: group })),
      ...(start + pageSize < names.length ? { NextToken: String(start + pageSize) } : {}),
    };
  }

  const handlers: Record<string, (input: never) => unknown> = {
    CreateSchedule: create,
    DeleteSchedule: remove,
    ListSchedules: list,
  };

  const client = {
    async send(command: { constructor: { name: string }; input: unknown }) {
      const operation = command.constructor.name.replace(/Command$/, "");
      sent.push({ operation, input: command.input });
      const handler = handlers[operation];
      if (handler === undefined) throw new Error(`the fake scheduler does not implement ${operation}`);
      return handler(command.input as never);
    },
  };

  return {
    client: client as unknown as SchedulerClient,
    sent,
    /** The schedules that exist now. */
    schedules: () => [...schedules.values()],
    /** Invokes, in time order, every schedule not yet fired whose minute has begun by `now`. */
    async fireDue(now: number, invoke: (input: string) => Promise<void> | void): Promise<void> {
      for (;;) {
        const due = [...schedules.values()]
          .filter((s) => !s.fired && minuteOf(s.fireAt) <= now)
          .sort((a, b) => a.fireAt - b.fireAt)[0];
        if (due === undefined) return;
        due.fired = true;
        if (due.deleteAfter) schedules.delete(key(due.group, due.name));
        await invoke(due.input);
      }
    },
    /** The start of the earliest minute at which a schedule not yet fired becomes due, or `undefined`. */
    nextDue(): number | undefined {
      const times = [...schedules.values()].filter((s) => !s.fired).map((s) => minuteOf(s.fireAt));
      return times.length === 0 ? undefined : Math.min(...times);
    },
  };
}
