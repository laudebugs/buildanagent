// Worker-side half of the runner. scripts/workerd.mjs bundles an entry that re-exports the example
// module and uses `harness(mod)` as its default export, so the example's Agent classes become
// Durable Objects and this handler drives them:
//   GET /__harness/probe?bindings=<json>  (doc examples) instantiate every Durable Object binding
//       through getAgentByName (Agents) or idFromName (plain Durable Objects), send it a request,
//       send one user message to chat agents (AIChatAgent, Think) with saveMessages(), send an MCP
//       initialize to McpAgent classes through their static serve(), then call the example's own
//       default fetch handler if it has one. Returns a JSON report.
//   GET /__harness/test  (our examples) run the example's exported `test(env, h)` and return
//       { ok, error }. `h.evict(className, name)` asks the host to evict that Durable Object
//       (Miniflare's unsafeEvictDurableObject), so examples can check hibernation-safe state.
// Any other request goes to the example's default handler.
import { Agent, getAgentByName } from "agents";

const errText = (e) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
// A 500 body is often a stack trace. Drop the checkout path from its frames before truncating, so the
// recorded text doesn't depend on where the repo is checked out.
const errBody = (text) => text.replace(/file:\/\/\/\S*?\/\.tmp\/docs\//g, ".tmp/docs/").slice(0, 300);

function defaultFetch(mod) {
  const d = mod.default;
  if (d && typeof d === "object" && typeof d.fetch === "function") return (req, env, ctx) => d.fetch(req, env, ctx);
  // A WorkerEntrypoint subclass as the default export.
  if (typeof d === "function" && typeof d.prototype?.fetch === "function")
    return (req, env, ctx) => new d(ctx, env).fetch(req);
  return null;
}

/** Host helpers our examples use (through the HARNESS service binding). */
const helpers = (env) => ({
  async evict(className, name) {
    const r = await env.HARNESS.fetch(
      `http://harness/evict?class=${encodeURIComponent(className)}&name=${encodeURIComponent(name)}`,
    );
    if (!r.ok) throw new Error(`evict failed: ${await r.text()}`);
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  /** Poll `fn` until it returns a truthy value or `ms` passes. */
  async until(fn, ms = 10000, every = 100) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, every));
    }
  },
});

const MCP_INIT = () =>
  new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-harness", version: "0" } },
    }),
  });

const isChat = (cls) =>
  typeof cls?.prototype?.saveMessages === "function" && typeof cls?.prototype?.onChatMessage === "function";

async function probe(mod, env, ctx, bindings) {
  const report = { bindings: [], default: null };
  for (const { name, className } of bindings) {
    const cls = mod[className];
    const entry = { name, className, agent: cls?.prototype instanceof Agent, chat: isChat(cls) };
    try {
      if (typeof cls?.serve === "function") {
        // McpAgent: addressed through its transport, not getAgentByName. Send an MCP initialize.
        entry.mcp = true;
        const r = await cls.serve("/mcp", { binding: name }).fetch(MCP_INIT(), env, ctx);
        entry.status = r.status;
        const body = (await r.text()).slice(0, 2000);
        entry.mcpInitialized = r.status < 300 && /"protocolVersion"/.test(body);
        if (r.status >= 500) entry.error = errBody(body);
      } else if (!entry.agent && typeof cls?.prototype?.fetch !== "function") {
        entry.status = "no-fetch"; // a plain Durable Object reached only through RPC
      } else {
        const stub = entry.agent
          ? await getAgentByName(env[name], "probe")
          : env[name].get(env[name].idFromName("probe"));
        const r = await stub.fetch(new Request("http://localhost/"));
        entry.status = r.status;
        if (r.status >= 500) entry.error = errBody(await r.text());
        if (entry.chat) {
          try {
            const res = await stub.saveMessages([
              { id: "probe-1", role: "user", parts: [{ type: "text", text: "Hello from the verify harness." }] },
            ]);
            entry.chatStatus = res?.status ?? "returned";
            if (res?.error) entry.chatError = errText(res.error);
          } catch (e) {
            // A doc class that leaves onChatMessage to the reader cannot answer a message.
            if (/override onChatMessage/.test(errText(e))) entry.chatStatus = "no-onChatMessage";
            else throw e;
          }
        }
      }
    } catch (e) {
      entry.error = errText(e);
    }
    report.bindings.push(entry);
  }
  const fetchDefault = defaultFetch(mod);
  if (fetchDefault) {
    try {
      const r = await fetchDefault(new Request("http://localhost/"), env, ctx);
      report.default = { status: r?.status ?? null };
      if (!(r instanceof Response)) report.default.error = "default fetch did not return a Response";
      else if (r.status >= 500) report.default.error = errBody(await r.text());
    } catch (e) {
      report.default = { error: errText(e) };
    }
  }
  return report;
}

export function harness(mod) {
  return {
    async fetch(req, env, ctx) {
      const url = new URL(req.url);
      if (url.pathname === "/__harness/probe") {
        const bindings = JSON.parse(url.searchParams.get("bindings") ?? "[]");
        return Response.json(await probe(mod, env, ctx, bindings));
      }
      if (url.pathname === "/__harness/test") {
        if (typeof mod.test !== "function") return Response.json({ ok: false, error: "no exported test()" });
        try {
          await mod.test(env, helpers(env), ctx);
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ ok: false, error: errText(e), stack: e?.stack?.split("\n").slice(0, 6).join("\n") });
        }
      }
      const fetchDefault = defaultFetch(mod);
      return fetchDefault ? fetchDefault(req, env, ctx) : new Response("no default handler", { status: 404 });
    },
  };
}
