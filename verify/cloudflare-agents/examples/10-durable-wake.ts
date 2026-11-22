// An agent's state and its schedule survive the Durable Object being evicted, and the schedule wakes the evicted
// agent with no request. The agent keeps a note in its state, schedules a callback, and is evicted. The new instance
// still has the note and the schedule, loses its in-memory field, and runs the callback by itself. The callback
// writes a row that names the instance's start count, so the check can see it ran on a new instance.
// Docs: agents/docs/agents/state.md, agents/docs/agents/scheduling.md, agents/docs/agents/lifecycle.md
import { Agent, getAgentByName } from "agents";
import { check, type Harness } from "./lib/check.ts";

type Env = { Reminders: DurableObjectNamespace<Reminders> };
type Plan = { note: string };

// #region durable-agent
export class Reminders extends Agent<Env, Plan> {
  override initialState: Plan = { note: "none" };
  inMemory = 0; // book:note memory

  override async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS starts (at INTEGER)`;
    this.sql`CREATE TABLE IF NOT EXISTS woke (note TEXT, at INTEGER, starts INTEGER, inMemory INTEGER)`;
    this.sql`INSERT INTO starts (at) VALUES (${Date.now()})`; // book:note start
  }

  async plan(note: string, afterSeconds: number) {
    this.inMemory = 42;
    this.setState({ note }); // book:note state
    return this.schedule(afterSeconds, "wake", { note }); // book:note schedule
  }

  // The schedule calls this by name, on whichever instance the alarm wakes.
  async wake(payload: Plan) {
    const starts = this.sql<{ n: number }>`SELECT count(*) AS n FROM starts`[0].n;
    this.sql`INSERT INTO woke VALUES (${payload.note}, ${Date.now()}, ${starts}, ${this.inMemory})`;
  }
}
// #endregion durable-agent

/** What the agent holds, read through one request. */
type Snapshot = {
  note: string;
  inMemory: number;
  starts: number;
  schedules: string[];
  woke: { note: string; at: number; starts: number; inMemory: number }[];
};

export class Probe extends Reminders {
  async snapshot(): Promise<Snapshot> {
    return {
      note: this.state.note,
      inMemory: this.inMemory,
      starts: this.sql<{ n: number }>`SELECT count(*) AS n FROM starts`[0].n,
      schedules: (await this.listSchedules()).map((s) => s.callback),
      woke: this.sql<Snapshot["woke"][number]>`SELECT note, at, starts, inMemory FROM woke`,
    };
  }
}

export async function test(env: { Probe: DurableObjectNamespace<Probe> }, h: Harness) {
  const agent = await getAgentByName(env.Probe, "desk");
  const due = await agent.plan("call back at noon", 4);
  const before = await agent.snapshot();
  check(before.starts === 1 && before.inMemory === 42, "before eviction: one start and the in-memory field is set");
  check(
    before.note === "call back at noon" && before.woke.length === 0,
    "the note is stored and nothing has woken yet",
  );
  check(before.schedules.includes("wake"), "the schedule holds the wake");

  // #region evict-and-wake
  await h.evict("Probe", "desk");
  // No request reaches the agent here. The alarm has to wake the evicted object itself.
  await h.sleep(6500);
  const asked = Date.now();
  const after = await (await getAgentByName(env.Probe, "desk")).snapshot();
  const woke = after.woke[0];
  // #endregion evict-and-wake
  check(after.note === "call back at noon", "the state was reloaded from storage on the new instance");
  check(after.inMemory === 0 && woke?.inMemory === 0, "the in-memory field did not survive eviction");
  check(woke?.note === "call back at noon", "the schedule's callback ran with its payload after the eviction");
  check(woke.starts === 2 && after.starts === 2, "the callback ran on the new instance, the agent's second start");
  check(woke.at >= due.time * 1000 - 50, "it ran at or after the schedule's due time");
  check(woke.at < asked, "it ran before any request reached the agent, so the alarm woke it");
  check(after.woke.length === 1, "the callback ran once");
  check(!after.schedules.includes("wake"), "the one-shot schedule was removed after it ran");
}
