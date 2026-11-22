// Ingress deduplication: a trigger carries an id from its sender, such as a webhook's delivery id. The agent writes the
// id to its own SQLite table with INSERT OR IGNORE before it starts any work, so a second delivery of the same id
// changes nothing, and the record survives the Durable Object being evicted. Alarms and webhooks both arrive at least
// once, so this is what makes a repeat harmless. Docs: agents/docs/agents/agent-class.md ("this.sql"),
// agents/docs/agents/lifecycle.md
import { Agent, getAgentByName } from "agents";
import { check, type Harness } from "./lib/check.ts";

type Env = { Intake: DurableObjectNamespace<Intake> };

// #region accept
export class Intake extends Agent<Env> {
  override async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY)`;
    this.sql`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, goal TEXT)`;
  }

  /** The sender's id decides: the first delivery of an id starts a task, and every later one is dropped. */
  accept(deliveryId: string, goal: string): { started: boolean } {
    this.sql`INSERT OR IGNORE INTO seen (id) VALUES (${deliveryId})`; // book:note stamp
    const first = this.ctx.storage.sql.exec("SELECT changes() AS n").one().n === 1; // book:note first
    if (first) this.sql`INSERT INTO tasks (id, goal) VALUES (${deliveryId}, ${goal})`; // book:note start
    return { started: first };
  }

  taskCount() {
    return this.sql<{ n: number }>`SELECT count(*) AS n FROM tasks`[0].n;
  }
}
// #endregion accept

export async function test(env: Env, h: Harness) {
  const agent = await getAgentByName(env.Intake, "intake");
  // #region twice
  const first = await agent.accept("delivery-1", "fix the failing test");
  const again = await agent.accept("delivery-1", "fix the failing test");
  check(first.started === true && again.started === false, "the same delivery id starts a task once"); // book:note once
  check((await agent.taskCount()) === 1, "one task exists after two deliveries");
  // #endregion
  const other = await agent.accept("delivery-2", "update the docs");
  check(other.started === true && (await agent.taskCount()) === 2, "a different id starts its own task");

  // #region evicted
  await h.evict("Intake", "intake");
  const late = await (await getAgentByName(env.Intake, "intake")).accept("delivery-1", "fix the failing test");
  check(late.started === false, "a redelivery after eviction is still dropped, because the id is in storage"); // book:note storage
  // #endregion
  check(
    (await (await getAgentByName(env.Intake, "intake")).taskCount()) === 2,
    "the evicted agent still holds two tasks",
  );
}
