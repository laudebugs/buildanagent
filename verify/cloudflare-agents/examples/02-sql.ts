// this.sql: a template tag over the Durable Object's synchronous SQLite API. Interpolated values
// become bound parameters (so quotes and SQL in them are data), results are typed row arrays, and
// rows persist in the agent's storage alongside the SDK's own cf_agents_* tables.
// Docs: agents/docs/agents/agent-class.md ("this.sql").
import { Agent, getAgentByName } from "agents";
import { check, type Harness } from "./lib/check.ts";

type Env = { NotesAgent: DurableObjectNamespace<NotesAgent> };
type Note = { id: number; body: string };

// #region notes-agent
export class NotesAgent extends Agent<Env> {
  override async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`;
  }
  add(body: string) {
    this.sql`INSERT INTO notes (body) VALUES (${body})`;
    return this.sql<{ n: number }>`SELECT count(*) AS n FROM notes`[0].n;
  }
  find(term: string) {
    return this.sql<Note>`SELECT id, body FROM notes WHERE body LIKE ${`%${term}%`} ORDER BY id`;
  }
  tables() {
    return this.sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`.map(
      (r) => r.name,
    );
  }
  rawCount() {
    // The same database through the Durable Object API the docs say this.sql wraps.
    return this.ctx.storage.sql.exec("SELECT count(*) AS n FROM notes").one().n;
  }
}
// #endregion notes-agent

export async function test(env: Env, _h: Harness) {
  const agent = await getAgentByName(env.NotesAgent, "notes");
  check((await agent.add("buy milk")) === 1, "onStart created the table and INSERT added a row");
  const hostile = "x'); DROP TABLE notes; --";
  check((await agent.add(hostile)) === 2, "a value containing SQL is bound as a parameter, not executed");
  const rows = await agent.find("DROP");
  check(rows.length === 1 && rows[0].body === hostile, "the hostile string round-trips as data");
  check(typeof rows[0].id === "number", "rows come back as typed objects (INTEGER -> number)");
  check((await agent.rawCount()) === 2, "this.ctx.storage.sql sees the same rows");
  const tables = await agent.tables();
  check(tables.includes("notes"), "the user table lives in the agent's SQLite database");
  check(
    tables.some((t) => t.startsWith("cf_agents_")),
    `the SDK keeps its own tables in the same database (${tables.filter((t) => t.startsWith("cf_")).join(", ")})`,
  );
}
