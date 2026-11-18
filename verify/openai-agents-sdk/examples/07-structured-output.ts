// Structured output with a Zod outputType: finalOutput is the parsed object.
// Docs: guides/agents.mdx "Output types", guides/results.mdx "Final output"
import { Agent, ModelBehaviorError } from "@openai/agents";
import { assistantMessage, ScriptedModel } from "@openai/agents/testing";
import { z } from "zod";
import { check, runner } from "./lib/check.ts";

const Ticket = z.object({ title: z.string(), priority: z.enum(["low", "medium", "high"]) });
{
  const model = new ScriptedModel([[assistantMessage(JSON.stringify({ title: "Login crash", priority: "high" }))]]);
  const agent = new Agent({ name: "Ticketer", model, outputType: Ticket });
  const result = await runner.run(agent, "Safari login crashes.");
  check(result.finalOutput?.priority === "high", "finalOutput is the parsed, typed object");
  const outputType = model.firstCall?.request.outputType;
  check(outputType !== "text" && outputType?.type === "json_schema", "the model receives a JSON Schema output type");
}
{
  const model = new ScriptedModel([[assistantMessage("not json")]]);
  const agent = new Agent({ name: "Ticketer", model, outputType: Ticket });
  let error: unknown;
  try {
    await runner.run(agent, "Safari login crashes.");
  } catch (e) {
    error = e;
  }
  check(error instanceof ModelBehaviorError, "output that fails the schema throws ModelBehaviorError");
}
