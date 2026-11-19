// An LlmAgent with a FunctionTool: the zod schema becomes the function declaration, ADK validates the
// model's arguments before the tool runs, a non-object result is wrapped as {result}, and the tool result
// goes back to the model before the final answer. Several calls in one model turn run sequentially.
// Docs: docs/tools-custom/function-tools.md (return values, lines 350-355); docs/agents/llm-agents.md.
import { FunctionTool, InMemoryRunner, isFinalResponse, LlmAgent } from "@google/adk";
import { z } from "zod";
import { afterTool, callTool, check, offered, responses, ScriptedLlm, say, turn } from "./lib/check.ts";

// #region function-tool
const executed: string[] = [];
const getOrderStatus = new FunctionTool({
  name: "get_order_status",
  description: "Look up an order by id.",
  parameters: z.object({ orderId: z.string().describe("The order id.") }),
  execute: ({ orderId }) => {
    executed.push(orderId);
    return `order ${orderId} shipped`;
  },
});
// #endregion

// Call 1 sends a number where the schema wants a string; call 2 retries with a string; call 3 answers.
const model = new ScriptedLlm((req, n) =>
  n === 1
    ? callTool("get_order_status", { orderId: 42 })
    : n === 2
      ? callTool("get_order_status", { orderId: "A-1" })
      : say(afterTool(req) ? "Your order A-1 has shipped." : "unexpected"),
);
const agent = new LlmAgent({ name: "support", model, instruction: "Answer order questions.", tools: [getOrderStatus] });
const runner = new InMemoryRunner({ agent, appName: "orders" });
const session = await runner.sessionService.createSession({ appName: "orders", userId: "u1" });
const events = await turn(runner, session.id, "Where is order A-1?");

const decl = (model.requests[0].config?.tools?.[0] as any)?.functionDeclarations?.[0];
check(offered(model.requests[0]).join() === "get_order_status", "the model is offered the tool by name");
check(
  decl.parameters.type === "OBJECT" && decl.parameters.properties.orderId.type === "STRING",
  "the zod schema becomes a Gemini Schema declaration (type OBJECT, orderId STRING)",
);
check(decl.parameters.required?.includes("orderId"), "required zod fields are marked required");
const [bad, good] = responses(events);
check(
  typeof bad.response?.error === "string" && /expected string/.test(String(bad.response.error)),
  "arguments that fail the zod schema come back to the model as {error}, not as an exception",
);
check(executed.join() === "A-1", "the tool body ran only for the valid call");
check(good.response?.result === "order A-1 shipped", "a string result is wrapped as {result: ...}");
check(model.requests.length === 3, "each tool result triggers another model call");
check(
  model.requests[2].contents.at(-1)?.parts?.[0]?.functionResponse?.name === "get_order_status",
  "the model sees the tool result as a functionResponse part",
);
const last = events.at(-1);
check(
  last && isFinalResponse(last) && last.content?.parts?.[0]?.text === "Your order A-1 has shipped.",
  "the last event is the final answer",
);
check(
  String(model.requests[0].config?.systemInstruction).includes('Your internal name is "support"'),
  "ADK prepends an identity preamble to the instruction",
);

// Two function calls in one model turn run one after the other in 2.5.0: the second starts after the
// first ends. Python ADK runs them concurrently since 1.10.0 (docs/tools-custom/performance.md).
{
  const spans: Array<[string, number, number]> = [];
  const slow = (name: string) =>
    new FunctionTool({
      name,
      description: `Slow lookup ${name}.`,
      parameters: z.object({}),
      execute: async () => {
        const start = performance.now();
        await new Promise((r) => setTimeout(r, 100));
        spans.push([name, start, performance.now()]);
        return { ok: name };
      },
    });
  const both = new ScriptedLlm((req) =>
    afterTool(req)
      ? say("both done")
      : {
          content: {
            role: "model",
            parts: [
              { functionCall: { id: "p1", name: "slow_a", args: {} } },
              { functionCall: { id: "p2", name: "slow_b", args: {} } },
            ],
          },
        },
  );
  const parallel = new LlmAgent({
    name: "par",
    model: both,
    instruction: "x",
    tools: [slow("slow_a"), slow("slow_b")],
  });
  const r = new InMemoryRunner({ agent: parallel, appName: "par" });
  const s = await r.sessionService.createSession({ appName: "par", userId: "u1" });
  const ev = await turn(r, s.id, "look up both");
  check(responses(ev).length === 2, "both calls from one model turn get a functionResponse");
  const [a, b] = spans;
  check(a && b && b[1] >= a[2], "the second call starts only after the first finishes (sequential, not parallel)");
}
