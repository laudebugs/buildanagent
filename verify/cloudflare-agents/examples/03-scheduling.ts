// Scheduling: schedule(seconds, callback, payload) runs the named method later with the payload
// (through a Durable Object alarm, which workerd fires locally), one-shot rows are removed after
// they run, scheduleEvery() is idempotent on (callback, interval, payload), cron and Date
// schedules get their own types, and cancelSchedule() removes a row.
// Docs: agents/docs/agents/scheduling.md ("Scheduling Modes", "Managing Schedules", "API Reference").
import { Agent, getAgentByName } from "agents";
import { check, type Harness } from "./lib/check.ts";

type Env = { ReminderAgent: DurableObjectNamespace<ReminderAgent> };
type Reminder = { text: string };

export class ReminderAgent extends Agent<Env> {
  override async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS fired (text TEXT, at INTEGER)`;
  }
  async remind(payload: Reminder) {
    this.sql`INSERT INTO fired (text, at) VALUES (${payload.text}, ${Date.now()})`;
  }
  async tick() {}

  async plan() {
    const delayed = await this.schedule(1, "remind", { text: "call back" });
    const every1 = await this.scheduleEvery(60, "tick");
    const every2 = await this.scheduleEvery(60, "tick");
    const cron = await this.schedule("0 9 * * 1", "tick");
    const dated = await this.schedule(new Date(Date.now() + 3600_000), "tick");
    return { delayed, every: [every1.id, every2.id], cronType: cron.type, datedType: dated.type, datedId: dated.id };
  }
  fired() {
    return this.sql<{ text: string; at: number }>`SELECT text, at FROM fired`;
  }
  async list() {
    return (await this.listSchedules()).map((s) => ({ id: s.id, type: s.type, callback: s.callback }));
  }
  cancel(id: string) {
    return this.cancelSchedule(id);
  }
}

export async function test(env: Env, h: Harness) {
  const agent = await getAgentByName(env.ReminderAgent, "reminders");
  const p = await agent.plan();
  check((await agent.fired()).length === 0, "the delayed callback has not run yet right after scheduling");
  check(p.delayed.type === "delayed" && p.delayed.callback === "remind", "a number schedules a 'delayed' task");
  check(p.every[0] === p.every[1], "scheduleEvery with the same arguments returns the existing schedule");
  check(p.cronType === "cron", "a cron string schedules a 'cron' task");
  check(p.datedType === "scheduled", "a Date schedules a 'scheduled' task");
  const before = await agent.list();
  check(
    before.some((s) => s.id === p.delayed.id),
    "listSchedules includes the pending delayed task",
  );
  check(before.filter((s) => s.type === "interval").length === 1, "only one interval row exists");

  const fired = await h.until(async () => (await agent.fired()).length > 0 && (await agent.fired()), 10000);
  check(fired && fired[0].text === "call back", "the callback ran with the scheduled payload");
  // workerd coarsens clocks, so compare against the schedule's own due time (epoch seconds).
  check(fired[0].at >= p.delayed.time * 1000 - 50, "it ran at or after the schedule's due time");
  const after = await h.until(async () => !(await agent.list()).some((s) => s.id === p.delayed.id), 3000);
  check(after, "a one-shot schedule is removed after it runs");

  check((await agent.cancel(p.datedId)) === true, "cancelSchedule returns true for an existing schedule");
  check(!(await agent.list()).some((s) => s.id === p.datedId), "the cancelled schedule is gone");
  check((await agent.cancel("no-such-id")) === false, "cancelSchedule returns false for an unknown id");
}
