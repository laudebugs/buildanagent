// A tool built with tool() and a Zod schema gets parsed arguments; its result returns to the model
// as a ToolMessage, and the loop continues until the model answers without tool calls.
// Docs: langchain/tools.mdx, langchain/agents.mdx
import { AIMessage } from "@langchain/core/messages";
import { createAgent, fakeModel, tool } from "langchain";
import { z } from "zod";
import { check, kind, text } from "./lib/check.ts";

const calls: unknown[] = [];
const weather = tool(
  async (input) => {
    calls.push(input);
    return `${input.city}: 21${input.unit}`;
  },
  {
    name: "get_weather",
    description: "Get the weather for a city",
    schema: z.object({ city: z.string(), unit: z.enum(["C", "F"]).default("C") }),
  },
);
const model = fakeModel()
  .respondWithTools([{ name: "get_weather", args: { city: "Lisbon" }, id: "call_1" }])
  .respond(new AIMessage("It is 21C in Lisbon."));
const result = await createAgent({ model, tools: [weather] }).invoke({
  messages: [{ role: "user", content: "Weather in Lisbon?" }],
});

check(
  JSON.stringify(calls) === JSON.stringify([{ city: "Lisbon", unit: "C" }]),
  "the tool gets parsed input with defaults",
);
check(
  JSON.stringify(result.messages.map(kind)) === '["human","ai","tool","ai"]',
  "human, tool call, tool result, answer",
);
const toolMsg = model.calls[1].messages.find((m) => kind(m) === "tool");
check(toolMsg && text(toolMsg) === "Lisbon: 21C", "the tool result reaches the next model call");
check(text(result.messages.at(-1)) === "It is 21C in Lisbon.", "the loop ends on the model's answer");
