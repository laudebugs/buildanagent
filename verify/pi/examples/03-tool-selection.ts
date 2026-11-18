// Choosing the active tool set, and what happens when the model calls a tool that isn't active.
// Docs: sdk.md "Configuring a session", how-pi-works.md "Agent loop"
import { check, fauxAssistantMessage, fauxSession, fauxText, fauxToolCall } from "./lib/faux.ts";

{
  const { session } = await fauxSession([], { tools: ["read", "grep", "find", "ls"] });
  check(
    JSON.stringify(session.getActiveToolNames()) === JSON.stringify(["read", "grep", "find", "ls"]),
    "tools: [...] selects a read-only set",
  );
  session.dispose();
}
{
  const { session } = await fauxSession([], { excludeTools: ["bash", "write"] });
  check(
    JSON.stringify(session.getActiveToolNames()) === JSON.stringify(["read", "edit"]),
    "excludeTools removes tools from the defaults",
  );
  session.dispose();
}
{
  const { session } = await fauxSession([], { noTools: "builtin" });
  check(session.getActiveToolNames().length === 0, 'noTools: "builtin" leaves no built-in tools');
  session.dispose();
}
{
  // An unknown tool call becomes an error tool result, and the loop continues.
  const { session, faux } = await fauxSession(
    [
      fauxAssistantMessage([fauxToolCall("ls", { path: "." })], { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxText("ls is unavailable; stopping.")),
    ],
    { tools: ["read"] },
  );
  await session.prompt("List the files.");
  const result = session.messages.find((m) => m.role === "toolResult") as
    | { isError?: boolean; content: unknown }
    | undefined;
  check(result?.isError === true, "calling an inactive tool yields an error tool result");
  check(JSON.stringify(result?.content).includes("not found"), "the error says the tool was not found");
  check(faux.state.callCount === 2, "the loop continues to another model request");
  session.dispose();
}
