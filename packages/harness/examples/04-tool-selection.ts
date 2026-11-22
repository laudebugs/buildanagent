// Choosing the tools a turn offers, and what happens when the model calls one that was not offered. The registry holds
// the six built-in tools, and each turn's `tools` list picks the ones its requests send. The book's Chapter 13 lists it
// beside Pi's tool selection. The models are scripted ones, so the example runs offline.
import { createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, openSession, runTurn } from "@buildanagent/harness/session";
import { check, memoryLock, scripted } from "./lib/check.js";
import { builtinRegistry } from "./lib/workspace.js";

const registry = await builtinRegistry({ "src/app.ts": "export const app = 1;\n" });
const ask = async (key: { userId: string; sessionId: string }) =>
  openSession({ store: memoryStore(), index: memoryIndex(), lock: memoryLock(), key });
const said = (text: string) => ({ content: [{ type: "text" as const, text }] });

// #region active-tools
{
  const { adapter, model } = scripted([said("Looked."), said("Fixed."), said("Hello.")]); // book:note scripted
  const harness = createHarness({ registry, model, system: "You help with code." });
  const session = await ask({ userId: "ada", sessionId: "select" });
  await runTurn(session, harness, { input: "Look around.", tools: ["glob", "read", "grep"] }); // book:note allowlist
  const kept = registry.list().filter((tool) => tool.name !== "bash" && tool.name !== "write");
  await runTurn(session, harness, { input: "Fix it.", tools: kept.map((tool) => tool.name) }); // book:note exclude
  await runTurn(session, harness, { input: "Just talk.", tools: [] }); // book:note none
  const sent = adapter.calls.map((call) => call.context.tools.map((tool) => tool.name));
  check(
    sent[0]?.join() === "read,grep,glob",
    "tools: [...] sends a read-only set, whatever order the list names them in",
  );
  check(sent[1]?.join() === "read,edit,grep,glob", "a list built from the registry leaves out two tools");
  check(sent[2]?.length === 0, "tools: [] sends no tool");
  await session.close();
}
// #endregion
// #region inactive-call
{
  const { adapter, model } = scripted([
    { content: [{ type: "tool_call", callId: "c1", name: "glob", input: { pattern: "*.ts" } }] },
    said("glob is unavailable; stopping."),
  ]); // book:note scripted-glob
  const harness = createHarness({ registry, model, system: "You help with code." });
  const session = await ask({ userId: "ada", sessionId: "inactive" });
  await runTurn(session, harness, { input: "List the files.", tools: ["read"] }); // book:note only-read
  const reply = adapter.calls[1]?.context.messages.at(-1);
  check(
    reply?.role === "tool" && reply.isError === true && JSON.stringify(reply).includes("no tool named"),
    "the call to glob yields an error tool result that says no tool has that name",
  ); // book:note error-result
  check(adapter.calls.length === 2, "the loop sends a second request"); // book:note continues
  await session.close();
}
// #endregion
