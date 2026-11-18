// Callbacks: before/after agent, model and tool. A before-callback that returns a value replaces the step
// (the agent, the model call or the tool never runs); an after-callback that returns a value replaces the
// result. Plugin hooks run first and, when they return a value, the agent-level callback is skipped.
// Plugin hooks take ONE object parameter; the docs' CountInvocationPlugin (docs/plugins/index.md:141) uses
// positional parameters, so its `context` argument is undefined at run time.
// Docs: docs/callbacks/types-of-callbacks.md; docs/plugins/index.md (precedence at lines 697-735).
import type { BaseAgent, BaseTool, Context, LlmRequest } from "@google/adk";
import { BasePlugin, FunctionTool, InMemoryRunner, LlmAgent } from "@google/adk";
import type { Content } from "@google/genai";
import { z } from "zod";
import { afterTool, callTool, check, responses, ScriptedLlm, say, texts, turn } from "./lib/check.ts";

const ran: string[] = [];
const refund = new FunctionTool({
  name: "refund",
  description: "Refund an order.",
  parameters: z.object({ orderId: z.string() }),
  execute: ({ orderId }) => {
    ran.push(orderId);
    return { refunded: orderId };
  },
});
const lookup = new FunctionTool({
  name: "lookup",
  description: "Look up an order.",
  parameters: z.object({ orderId: z.string() }),
  execute: ({ orderId }) => ({ orderId, status: "shipped" }),
});
const run = async (agent: LlmAgent, text: string, plugins: BasePlugin[] = []) => {
  const runner = new InMemoryRunner({ agent, appName: "cb", plugins });
  const s = await runner.sessionService.createSession({ appName: "cb", userId: "u1" });
  return turn(runner, s.id, text);
};

// beforeAgentCallback returning Content skips the agent: no model call.
{
  const model = new ScriptedLlm(() => say("model ran"));
  const agent = new LlmAgent({
    name: "gate",
    model,
    instruction: "x",
    beforeAgentCallback: () => ({ role: "model", parts: [{ text: "closed today" }] }),
  });
  const events = await run(agent, "hi");
  check(
    model.requests.length === 0 && texts(events).join() === "closed today",
    "beforeAgentCallback returning Content skips the agent",
  );
}

// beforeModelCallback returning an LlmResponse skips the model; afterModelCallback rewrites a response.
{
  const model = new ScriptedLlm(() => say("raw answer"));
  let seen: LlmRequest | undefined;
  const cached = new LlmAgent({
    name: "cached",
    model,
    instruction: "x",
    beforeModelCallback: ({ request }) => {
      seen = request;
      return say("from cache");
    },
  });
  const e1 = await run(cached, "hi");
  check(
    model.requests.length === 0 && texts(e1).join() === "from cache",
    "beforeModelCallback returning a response skips the model call",
  );
  check(seen?.contents.at(-1)?.parts?.[0]?.text === "hi", "beforeModelCallback receives the LlmRequest");

  const rewritten = new LlmAgent({
    name: "rewritten",
    model,
    instruction: "x",
    afterModelCallback: ({ response }) => say(`[redacted] ${response.content?.parts?.[0]?.text?.length} chars`),
  });
  const e2 = await run(rewritten, "hi");
  check(texts(e2).join() === "[redacted] 10 chars", "afterModelCallback returning a response replaces the model's");
}

// beforeToolCallback returning an object blocks the tool; afterToolCallback rewrites a result.
{
  const model = new ScriptedLlm((req) => (afterTool(req) ? say("done") : callTool("refund", { orderId: "A-1" })));
  const blocked = new LlmAgent({
    name: "blocked",
    model,
    instruction: "x",
    tools: [refund],
    beforeToolCallback: ({ tool, args }) =>
      tool.name === "refund" ? { error: `refund of ${args.orderId} needs a human` } : undefined,
  });
  const events = await run(blocked, "refund A-1");
  check(ran.length === 0, "beforeToolCallback returning an object means the tool body never runs");
  check(
    responses(events)[0]?.response?.error === "refund of A-1 needs a human",
    "the returned object is the tool result the model sees",
  );

  const model2 = new ScriptedLlm((req) => (afterTool(req) ? say("done") : callTool("lookup", { orderId: "A-1" })));
  const after = new LlmAgent({
    name: "after",
    model: model2,
    instruction: "x",
    tools: [lookup],
    afterToolCallback: ({ response }) => ({ ...response, note: "checked" }),
  });
  const e2 = await run(after, "status?");
  check(
    responses(e2)[0]?.response?.note === "checked",
    "afterToolCallback returning an object replaces the tool result",
  );
}

// Plugins: hooks take one object; a plugin that returns a value pre-empts the agent's callback.
{
  const order: string[] = [];
  class Guard extends BasePlugin {
    constructor() {
      super("guard");
    }
    override async beforeToolCallback({
      tool,
      toolArgs,
    }: {
      tool: BaseTool;
      toolArgs: Record<string, unknown>;
      toolContext: Context;
    }) {
      order.push(`plugin:${tool.name}`);
      return tool.name === "refund" ? { error: `blocked ${toolArgs.orderId} by policy` } : undefined;
    }
  }
  // The shape the docs' CountInvocationPlugin uses: positional (agent, context).
  let positionalContext: unknown = "unset";
  class Positional extends BasePlugin {
    constructor() {
      super("positional");
    }
    // The docs' positional signature does not match BasePlugin's single object parameter; tsc reports
    // TS2416 on the class (see docs__plugins__index__01 in results/typecheck-docs.json), so the instance is cast.
    // @ts-expect-error The docs' positional signature does not match BasePlugin's object parameter.
    override async beforeAgentCallback(agent: BaseAgent, context: Context): Promise<Content | undefined> {
      positionalContext = context;
      order.push(`positional-first-arg-keys:${Object.keys(agent).sort().join("+")}`);
      return undefined;
    }
  }
  const model = new ScriptedLlm((req) => (afterTool(req) ? say("done") : callTool("refund", { orderId: "B-2" })));
  const agent = new LlmAgent({
    name: "guarded",
    model,
    instruction: "x",
    tools: [refund],
    beforeToolCallback: () => {
      order.push("agent-callback");
      return undefined;
    },
  });
  const events = await run(agent, "refund B-2", [new Guard(), new Positional() as unknown as BasePlugin]);
  check(
    responses(events)[0]?.response?.error === "blocked B-2 by policy" && ran.length === 0,
    "a plugin's beforeToolCallback can block a tool",
  );
  check(!order.includes("agent-callback"), "when a plugin hook returns a value, the agent-level callback is skipped");
  check(positionalContext === undefined, "a positional (agent, context) plugin hook gets context === undefined");
  check(
    order.some((o) => o === "positional-first-arg-keys:agent+callbackContext"),
    "the first argument is the params object {agent, callbackContext}, not the agent",
  );
}
