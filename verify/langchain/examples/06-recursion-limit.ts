// The loop stops at the recursion limit, 25 graph super-steps by default, with GraphRecursionError.
// Each model call and each tool step is a super-step, so the default allows about 12 tool rounds.
// Docs: langgraph/graph-api.mdx ("Recursion limit"), langchain/agents.mdx
import { GraphRecursionError } from "@langchain/langgraph";
import { createAgent, fakeModel, tool } from "langchain";
import { z } from "zod";
import { check } from "./lib/check.ts";

const ping = tool(async () => "pong", { name: "ping", description: "Ping", schema: z.object({}) });
const loopForever = () => {
  const m = fakeModel();
  for (let i = 0; i < 60; i++) m.respondWithTools([{ name: "ping", args: {} }]);
  return m;
};

// #region attempt
async function attempt(config?: { recursionLimit: number }) {
  const model = loopForever();
  try {
    await createAgent({ model, tools: [ping] }).invoke({ messages: [{ role: "user", content: "Loop." }] }, config);
    return { error: undefined, calls: model.callCount };
  } catch (e) {
    return { error: e, calls: model.callCount };
  }
}
// #endregion

{
  const { error, calls } = await attempt();
  check(error instanceof GraphRecursionError, "the default limit throws GraphRecursionError");
  check(error instanceof Error && /Recursion limit of 25/.test(error.message), "the default limit is 25");
  check(calls === 13, `25 super-steps allow 13 model calls (got ${calls})`);
}
{
  const { error, calls } = await attempt({ recursionLimit: 5 });
  check(
    error instanceof GraphRecursionError && calls === 3,
    `recursionLimit: 5 stops after 3 model calls (got ${calls})`,
  );
}
