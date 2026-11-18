// Behavior: a defineTool() tool with a Zod schema is offered to the model under its own name; the
// SDK runs its handler in this process with parsed arguments, the runtime asks onPermissionRequest
// first (kind "custom-tool"), and the handler's return value reaches the model as the tool result.
// Docs: nodejs/README.md "Tools", docs/features/agent-loop.md.
import { CopilotClient, defineTool, type PermissionRequest, type SessionEvent } from "@github/copilot-sdk";
import { z } from "zod";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

const calls: unknown[] = [];
const getWeather = defineTool("get_weather", {
  description: "Get the weather for a city",
  parameters: z.object({ city: z.string().describe("City name") }),
  handler: async ({ city }, invocation) => {
    calls.push({ city, toolName: invocation.toolName });
    return `Sunny and 21C in ${city}`;
  },
});

const asked: PermissionRequest[] = [];
const client = new CopilotClient({ useLoggedInUser: false });
const session = await client.createSession({
  model: MODEL,
  provider: mockProvider(),
  tools: [getWeather],
  onPermissionRequest: (request) => {
    asked.push(request);
    return { kind: "approve-once" };
  },
});
const events: SessionEvent[] = [];
session.on((e) => events.push(e));

const reply = await session.sendAndWait({
  prompt: 'Use get_weather for Lisbon.\nmock-args get_weather {"city":"Lisbon"}\nmock-reply: Done.',
});

check(calls.length === 1, "the handler ran once");
check(JSON.stringify(calls[0]) === JSON.stringify({ city: "Lisbon", toolName: "get_weather" }), "with parsed args");
const first = mockRequests()[0];
const offered = first.body.tools.find((t: any) => t.name === "get_weather");
check(offered?.input_schema?.properties?.city?.type === "string", "the Zod schema reached the model as JSON Schema");
check(asked.length === 1 && asked[0].kind === "custom-tool", "onPermissionRequest was asked once, kind custom-tool");
check(
  events.some((e) => e.type === "tool.execution_start") && events.some((e) => e.type === "tool.execution_complete"),
  "tool.execution_start and tool.execution_complete events were emitted",
);
check(reply?.data.content.includes("Sunny and 21C in Lisbon") === true, "the tool result reached the model");

await session.disconnect();
await client.stop();
