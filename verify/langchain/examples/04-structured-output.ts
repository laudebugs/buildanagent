// responseFormat with a Zod schema makes the agent return a typed structuredResponse. Without a
// provider strategy, createAgent offers the schema as a tool named after the schema's title.
// Docs: langchain/structured-output.mdx
import { createAgent, fakeModel } from "langchain";
import { z } from "zod";
import { check } from "./lib/check.ts";

const Triage = z
  .object({ category: z.enum(["bug", "billing", "question"]), urgent: z.boolean() })
  .meta({ title: "Triage" });
const model = fakeModel().respondWithTools([{ name: "Triage", args: { category: "billing", urgent: true } }]);
const result = await createAgent({ model, tools: [], responseFormat: Triage }).invoke({
  messages: [{ role: "user", content: "I was charged twice!" }],
});
const out: { category: "bug" | "billing" | "question"; urgent: boolean } = result.structuredResponse;
check(out.category === "billing" && out.urgent, "structuredResponse is the parsed, typed object");
check(model.callCount === 1, "the structured-output tool call ends the run");
