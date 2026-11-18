// Structured output with a JSON Schema: the validated object lands on result.structured_output.
// Docs: structured-outputs.md "Quick start", "Recognize the StructuredOutput tool call"
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { check, collect } from "./lib/collect.ts";

const Ticket = z.object({
  title: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  labels: z.array(z.string()),
});
const { messages, result } = await collect(
  query({
    prompt: "Turn this into a ticket: the login page crashes on Safari.",
    // The SDK validates with JSON Schema draft-07; Zod 4 defaults to 2020-12, which the CLI rejects.
    options: {
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(Ticket, { target: "draft-7" }) },
      maxTurns: 4,
    },
  }),
);

const usedTool = messages.some(
  (m) =>
    m.type === "assistant" &&
    m.message.content.some((b: any) => b.type === "tool_use" && b.name === "StructuredOutput"),
);
check(usedTool, "model answers through the StructuredOutput tool");
check(result?.subtype === "success", "result is success");
const parsed = Ticket.safeParse(result?.subtype === "success" ? result.structured_output : undefined);
check(parsed.success, "structured_output validates against the Zod schema");
