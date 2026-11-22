// Behavior: availableTools and excludedTools decide which tools the model is offered. With
// availableTools = ToolSet().addCustom("*") no built-in reaches the model; excludedTools removes
// named built-ins and wins over availableTools when both match.
// mode: "empty" refuses a session that doesn't set availableTools.
// Docs: nodejs/README.md "Tools" and the availableTools/excludedTools JSDoc in types.d.ts,
// docs/features/changing-tools.md, CopilotClientMode JSDoc in types.d.ts.
import { approveAll, BuiltInTools, CopilotClient, defineTool, ToolSet } from "@github/copilot-sdk";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

const ping = defineTool("ping", { description: "Reply pong", handler: () => "pong" });
const client = new CopilotClient({ useLoggedInUser: false });
const base = { model: MODEL, provider: mockProvider(), onPermissionRequest: approveAll, tools: [ping] };
const offered = async (config: object, label: string) => {
  const s = await client.createSession({ ...base, ...config });
  await s.sendAndWait({ prompt: `${label}\nmock-reply: ok` });
  await s.disconnect();
  return mockRequests().at(-1)?.tools ?? [];
};

// #region offered
const all = await offered({}, "default");
check(
  all.includes("bash") && all.includes("edit") && all.includes("ping"),
  `default: built-ins plus ping (${all.length} tools)`,
);

const onlyCustom = await offered({ availableTools: new ToolSet().addCustom("*") }, "custom only"); // book:note custom-only
check(
  JSON.stringify(onlyCustom) === JSON.stringify(["ping"]),
  `availableTools custom:* offers only ping (got ${onlyCustom})`,
);

const noShell = await offered({ excludedTools: ["bash", "edit", "create"] }, "excluded"); // book:note excluded
check(!noShell.some((t) => ["bash", "edit", "create"].includes(t)), "excludedTools removes bash, edit and create");
check(noShell.includes("view") && noShell.includes("ping"), "other tools stay");

const both = await offered({ availableTools: ["ping", "view"], excludedTools: ["view"] }, "both"); // book:note exclude-wins
check(JSON.stringify(both) === JSON.stringify(["ping"]), `excludedTools wins over availableTools (got ${both})`);
// #endregion

const isolated = await offered({ availableTools: new ToolSet().addBuiltIn(BuiltInTools.Isolated) }, "isolated");
check(
  !isolated.includes("bash") && !isolated.includes("view") && !isolated.includes("ping"),
  `BuiltInTools.Isolated has no host tools (got ${isolated})`,
);

await client.stop();

// mode: "empty" (for multi-user servers) needs an explicit persistence location, and refuses a session
// that doesn't choose its tools with availableTools.
const empty = new CopilotClient({
  useLoggedInUser: false,
  mode: "empty",
  baseDirectory: `${process.env.HOME}/empty-mode`,
});
const refused = await empty.createSession({ ...base }).then(
  () => "created",
  (e: Error) => e.message,
);
check(/did not specify 'availableTools'/.test(refused), "mode empty rejects a session without availableTools");
const es = await empty.createSession({ ...base, availableTools: new ToolSet().addCustom("*") });
await es.sendAndWait({ prompt: "empty mode\nmock-reply: ok" });
check(JSON.stringify(mockRequests().at(-1)?.tools) === JSON.stringify(["ping"]), "and with custom:* offers only ping");
await es.disconnect();
await empty.stop();
