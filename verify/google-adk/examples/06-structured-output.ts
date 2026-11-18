// Structured output: outputSchema (zod) is sent as a Gemini responseSchema with responseMimeType
// application/json, and outputKey stores the PARSED object in state. With tools on the Gemini API backend,
// ADK adds a set_model_response tool instead and turns its arguments into the final answer.
// Surprise: a reply that is not JSON, or JSON that fails the schema, is only logged at ERROR level; the run
// succeeds and outputKey holds the raw text or the invalid object. The docs say the final response "must"
// conform (docs/agents/llm-agents.md:487-489); Python raises on invalid output.
import type { Logger } from "@google/adk";
import { FunctionTool, InMemoryRunner, LlmAgent, setLogger } from "@google/adk";
import { z } from "zod";
import { callTool, check, offered, ScriptedLlm, say, texts, turn } from "./lib/check.ts";

const errors: string[] = [];
const quiet = () => {};
setLogger({
  log: quiet,
  debug: quiet,
  info: quiet,
  warn: quiet,
  error: (...m: unknown[]) => errors.push(m.join(" ")),
  setLogLevel: quiet,
} satisfies Logger);

const Ticket = z.object({ category: z.enum(["billing", "bug"]), priority: z.number() });
async function classify(reply: string) {
  const model = new ScriptedLlm(() => say(reply));
  const agent = new LlmAgent({
    name: "triage",
    model,
    instruction: "Classify.",
    outputSchema: Ticket,
    outputKey: "ticket",
  });
  const runner = new InMemoryRunner({ agent, appName: "so" });
  const s = await runner.sessionService.createSession({ appName: "so", userId: "u1" });
  const events = await turn(runner, s.id, "I was charged twice");
  const state = (await runner.sessionService.getSession({ appName: "so", userId: "u1", sessionId: s.id }))?.state;
  return { model, events, ticket: state?.ticket };
}

const ok = await classify('{"category":"billing","priority":2}');
const cfg = ok.model.requests[0].config;
check(cfg?.responseMimeType === "application/json", "outputSchema sets responseMimeType application/json");
check(
  (cfg?.responseSchema as any)?.properties?.category?.enum?.join() === "billing,bug",
  "the zod schema becomes the request's responseSchema",
);
check(
  JSON.stringify(ok.ticket) === '{"category":"billing","priority":2}',
  "outputKey stores the parsed object, not the JSON text",
);

const notJson = await classify("sorry, I cannot do that");
check(!notJson.events.some((e) => e.errorCode), "a non-JSON reply produces no error event");
check(notJson.ticket === "sorry, I cannot do that", "a non-JSON reply is stored in outputKey as raw text");
check(
  errors.some((e) => e.includes("Error parsing output for agent triage")),
  "the parse failure is only logged",
);

const invalid = await classify('{"category":"refund","priority":2}');
check((invalid.ticket as any)?.category === "refund", "JSON that violates the schema is stored anyway");
check(
  errors.some((e) => e.includes("does not satisfy its output schema")),
  "the schema violation is only logged",
);

// With tools: set_model_response carries the structured answer.
const lookup = new FunctionTool({
  name: "lookup_account",
  description: "Look up the account.",
  parameters: z.object({ email: z.string() }),
  execute: () => ({ plan: "pro" }),
});
const model = new ScriptedLlm((_req, n) =>
  n === 1
    ? callTool("lookup_account", { email: "a@example.com" })
    : callTool("set_model_response", { category: "billing", priority: 1 }),
);
const agent = new LlmAgent({
  name: "triage",
  model,
  instruction: "Classify.",
  outputSchema: Ticket,
  outputKey: "ticket",
  tools: [lookup],
});
const runner = new InMemoryRunner({ agent, appName: "so2" });
const s = await runner.sessionService.createSession({ appName: "so2", userId: "u1" });
const events = await turn(runner, s.id, "I was charged twice");
check(offered(model.requests[0]).includes("set_model_response"), "with tools, ADK offers a set_model_response tool");
check(
  model.requests[0].config?.responseSchema === undefined,
  "with tools, no responseSchema is sent (Gemini API backend)",
);
check(
  texts(events).at(-1) === '{"category":"billing","priority":1}',
  "set_model_response's arguments become the final text answer",
);
const state = (await runner.sessionService.getSession({ appName: "so2", userId: "u1", sessionId: s.id }))?.state;
check((state?.ticket as any)?.category === "billing", "and the parsed object lands in outputKey");
