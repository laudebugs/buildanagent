// A custom tool passed through createAgentSession({ customTools }), called by the model.
// Docs: sdk.md "Configuring a session", extensions.md "Custom tools", how-pi-works.md "Agent loop"
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { check, fauxAssistantMessage, fauxSession, fauxText, fauxToolCall } from "./lib/faux.ts";

// #region custom-tool
const calls: unknown[] = [];
const weather = defineTool({
  name: "get_temperature",
  label: "Temperature",
  description: "Get the current temperature for a city",
  parameters: Type.Object({ city: Type.String() }), // book:note schema
  execute: async (_id, params) => { // book:note execute
    calls.push(params);
    return { content: [{ type: "text", text: `21°C in ${params.city}` }], details: {} };
  },
});
// #endregion

// #region session
const { session, faux } = await fauxSession(
  [
    fauxAssistantMessage([fauxToolCall("get_temperature", { city: "Lisbon" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxText("It is 21°C in Lisbon.")),
  ],
  { customTools: [weather] },
);
// #endregion
const events: string[] = [];
session.subscribe((e) => events.push(e.type));
try {
  await session.prompt("What's the temperature in Lisbon?");
  check(session.getActiveToolNames().includes("get_temperature"), "custom tool joins the active tool set");
  check(
    calls.length === 1 && (calls[0] as { city: string }).city === "Lisbon",
    "execute() received the model's arguments",
  );
  check(
    events.includes("tool_execution_start") && events.includes("tool_execution_end"),
    "tool execution events stream",
  );
  const result = session.messages.find((m) => m.role === "toolResult");
  check(result && JSON.stringify(result).includes("21°C in Lisbon"), "tool result is recorded in the transcript");
  check(faux.state.callCount === 2, "two model requests: tool call, then the final answer");
  check(session.getLastAssistantText() === "It is 21°C in Lisbon.", "final answer follows the tool result");
} finally {
  session.dispose();
}
