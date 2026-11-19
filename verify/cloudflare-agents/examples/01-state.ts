// Agent state: setState() persists state, onStateChanged() fires after each update with source
// "server", connected WebSocket clients receive the new state, and the deprecated onStateUpdate()
// still fires. Materializing initialState also fires the hook once (a surprise). Also checks the
// routing fallback: routeAgentRequest resolves to null for a non-agent path, so the un-awaited
// `routeAgentRequest(request, env) || new Response(...)` in cloudflare-docs agent-class/index.mdx:196
// never reaches its 404 and returns null. Docs: agents/docs/agents/state.md; Agent.onStateChanged in agents' .d.ts.
import { Agent, getAgentByName, routeAgentRequest } from "agents";
import { check, type Harness } from "./lib/check.ts";

type Counter = { count: number };
type Env = { CounterAgent: DurableObjectNamespace<CounterAgent>; LegacyAgent: DurableObjectNamespace<LegacyAgent> };

// #region counter-agent
export class CounterAgent extends Agent<Env, Counter> {
  override initialState: Counter = { count: 0 };
  changes: { count: number; source: string }[] = [];

  increment() {
    this.setState({ count: this.state.count + 1 });
    return this.state.count;
  }
  override onStateChanged(state: Counter | undefined, source: unknown) {
    this.changes.push({ count: state?.count ?? -1, source: source === "server" ? "server" : "client" });
  }
  history() {
    return this.changes;
  }
  read() {
    return this.state.count;
  }
}
// #endregion

/** Uses the deprecated hook name, which the .d.ts says still works until the next major. */
export class LegacyAgent extends Agent<Env, Counter> {
  override initialState: Counter = { count: 0 };
  seen = 0;
  bump() {
    this.setState({ count: this.state.count + 1 });
  }
  override onStateUpdate() {
    this.seen++;
  }
  calls() {
    return this.seen;
  }
}

export async function test(env: Env, _h: Harness) {
  // Surprise: materializing initialState (the first read of this.state on a new agent) persists it
  // with setState, so onStateChanged fires once with the initial state and source "server".
  const fresh = await getAgentByName(env.CounterAgent, "first-read");
  check((await fresh.history()).length === 0, "nothing fires before state is read");
  check((await fresh.read()) === 0, "a new agent reads initialState");
  const first = await fresh.history();
  check(first.length === 1 && first[0].count === 0, "the first read of initialState fires onStateChanged once");

  const agent = await getAgentByName(env.CounterAgent, "state-demo");
  // A WebSocket client of this agent receives state broadcasts.
  const res = await agent.fetch("http://localhost/", { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  check(ws, "the agent accepts a WebSocket connection");
  ws.accept();
  const messages: any[] = [];
  ws.addEventListener("message", (e) => messages.push(JSON.parse(String(e.data))));

  check((await agent.increment()) === 1, "setState updates this.state synchronously");
  await agent.increment();
  const history = (await agent.history()).slice(1); // drop the initialState notification
  check(history.length === 2, "onStateChanged fires once per setState");
  check(
    history.every((h) => h.source === "server") && history.map((h) => h.count).join() === "1,2",
    "a server-side setState reports source 'server' with the new state",
  );
  await new Promise((r) => setTimeout(r, 200));
  const states = messages.filter((m) => m.type === "cf_agent_state").map((m) => m.state.count);
  check(states.at(0) === 0, "a new connection first receives the current state (cf_agent_state)");
  check(states.at(-1) === 2, "each setState is broadcast to connected clients");
  ws.close();

  const legacy = await getAgentByName(env.LegacyAgent, "legacy");
  await legacy.bump();
  await legacy.bump();
  // Two bumps plus the initialState notification.
  await testRouting(env);
  check((await legacy.calls()) === 3, "the deprecated onStateUpdate hook still fires (with a console warning)");
}

/** The handler from cloudflare-docs agent-class/index.mdx:196, verbatim apart from the env type. */
const docHandler = {
  async fetch(request: Request, env: Env) {
    return routeAgentRequest(request, env) || new Response("Not found", { status: 404 });
  },
};

async function testRouting(env: Env) {
  const req = () => new Request("http://localhost/not-an-agent");
  check((await routeAgentRequest(req(), env)) === null, "routeAgentRequest resolves to null for a non-agent path");
  check((await docHandler.fetch(req(), env)) === null, "so the doc's un-awaited || fallback returns null, not a 404");
  const fixed = (await routeAgentRequest(req(), env)) || new Response("Not found", { status: 404 });
  check(fixed.status === 404, "awaiting first (as think/index.md does) reaches the 404");
  const routed = await routeAgentRequest(new Request("http://localhost/agents/counter-agent/r1"), env);
  check(
    routed?.status === 200 || routed?.status === 404,
    `a /agents/<kebab-class>/<name> path routes (${routed?.status})`,
  );
}
