// Hibernation-safe state: after the Durable Object is evicted with its WebSockets hibernated
// (Miniflare's unsafeEvictDurableObject), a new instance starts (onStart runs again, in-memory
// fields reset), this.state and this.sql rows are reloaded from SQLite, the hibernated WebSocket
// stays open, its per-connection state survives, and onMessage runs on the new instance.
// Docs: agents/docs/agents/state.md, agents/docs/agents/lifecycle.md,
// agents/docs/agents/http-websockets.md (connection.setState, hibernation).
import { Agent, type Connection, type ConnectionContext, getAgentByName, type WSMessage } from "agents";
import { check, type Harness } from "./lib/check.ts";

type Env = { Room: DurableObjectNamespace<Room> };
type RoomState = { topic: string };

export class Room extends Agent<Env, RoomState> {
  override initialState: RoomState = { topic: "none" };
  memory = 0; // in-memory only: lost on eviction

  override async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS starts (at INTEGER)`;
    this.sql`INSERT INTO starts (at) VALUES (${Date.now()})`;
  }
  override onConnect(connection: Connection, ctx: ConnectionContext) {
    connection.setState({ user: new URL(ctx.request.url).searchParams.get("user") });
  }
  override onMessage(connection: Connection, message: WSMessage) {
    const user = (connection.state as { user?: string } | null)?.user ?? "?";
    connection.send(JSON.stringify({ type: "echo", user, text: String(message), memory: this.memory }));
  }
  setTopic(topic: string) {
    this.memory = 42;
    this.setState({ topic });
  }
  snapshot() {
    return {
      topic: this.state.topic,
      memory: this.memory,
      starts: this.sql<{ n: number }>`SELECT count(*) AS n FROM starts`[0].n,
      connections: [...this.getConnections()].length,
    };
  }
}

export async function test(env: Env, h: Harness) {
  const room = await getAgentByName(env.Room, "lobby");
  const res = await room.fetch("http://localhost/?user=ada", { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  check(ws, "a client connects over WebSocket");
  ws.accept();
  const inbox: any[] = [];
  ws.addEventListener("message", (e) => inbox.push(JSON.parse(String(e.data))));

  await room.setTopic("launch");
  const before = await room.snapshot();
  check(before.topic === "launch" && before.memory === 42 && before.starts === 1, "before eviction: one start");

  await h.evict("Room", "lobby");
  const after = await (await getAgentByName(env.Room, "lobby")).snapshot();
  check(after.starts === 2, "eviction ended the instance: onStart ran again on wake");
  check(after.memory === 0, "in-memory fields reset on the new instance");
  check(after.topic === "launch", "this.state was reloaded from storage");
  check(after.connections === 1, "the hibernated WebSocket is still listed by getConnections()");

  ws.send("hello after hibernation");
  const echo = await h.until(() => inbox.find((m) => m.type === "echo"), 5000);
  check(echo, "the hibernated WebSocket still delivers messages; onMessage ran on the new instance");
  check(echo.user === "ada", "per-connection state set in onConnect survived hibernation");
  check(echo.memory === 0, "the reply came from the new instance (memory reset)");
  ws.close();
}
