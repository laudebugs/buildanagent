// humanInTheLoopMiddleware interrupts before a gated tool runs; the result carries __interrupt__
// with the action request, and invoking a Command({ resume: { decisions } }) on the same thread
// runs the tool (approve) or skips it (reject). Interrupts need a checkpointer and a thread_id.
// Docs: langchain/human-in-the-loop.mdx, langgraph/interrupts.mdx
import { AIMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createAgent, fakeModel, humanInTheLoopMiddleware, tool } from "langchain";
import { z } from "zod";
import { check, kind } from "./lib/check.ts";

async function run(decision: "approve" | "reject", thread: string) {
  const executed: string[] = [];
  const executeSql = tool(
    async ({ query }) => {
      executed.push(query);
      return "3 rows deleted";
    },
    { name: "execute_sql", description: "Run SQL", schema: z.object({ query: z.string() }) },
  );
  // #region fake-model
  const model = fakeModel()
    .respondWithTools([{ name: "execute_sql", args: { query: "DELETE FROM old" }, id: "call_sql" }]) // book:note first-turn
    .respond(new AIMessage("Done.")); // book:note second-turn
  // #endregion
  // #region interrupt-on
  const agent = createAgent({
    model,
    tools: [executeSql],
    middleware: [
      humanInTheLoopMiddleware({ interruptOn: { execute_sql: { allowedDecisions: ["approve", "reject"] } } }), // book:note rule
    ],
    checkpointer: new MemorySaver(), // book:note checkpointer
  });
  // #endregion
  const config = { configurable: { thread_id: thread } };
  // #region resume
  const first: any = await agent.invoke({ messages: [{ role: "user", content: "Delete old records" }] }, config); // book:note pause
  const request = first.__interrupt__?.[0]?.value?.actionRequests?.[0];
  check(request?.name === "execute_sql", `${decision}: the run interrupts with the execute_sql action request`);
  check(executed.length === 0, `${decision}: the tool has not run before the decision`);
  const second = await agent.invoke(new Command({ resume: { decisions: [{ type: decision }] } }), config); // book:note resume
  // #endregion
  return { executed, second, model };
}

{
  const { executed, second } = await run("approve", "t-approve");
  check(JSON.stringify(executed) === '["DELETE FROM old"]', "approve: the tool runs exactly once after resuming");
  check(kind(second.messages.at(-1)) === "ai", "approve: the model then answers");
}
{
  const { executed, second } = await run("reject", "t-reject");
  check(executed.length === 0, "reject: the tool never runs");
  const toolMsg = second.messages.find((m) => kind(m) === "tool");
  check(toolMsg !== undefined, "reject: the model receives a tool message about the rejection");
}
