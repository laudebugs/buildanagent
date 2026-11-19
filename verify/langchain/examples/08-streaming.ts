// agent.stream() with streamMode "updates" yields one chunk per graph step, keyed by node name;
// "values" yields the full state after each step. Docs: langchain/streaming.mdx, langgraph/streaming.mdx
import { AIMessage } from "@langchain/core/messages";
import { createAgent, fakeModel, tool } from "langchain";
import { z } from "zod";
import { check } from "./lib/check.ts";

const lookup = tool(async () => "found", { name: "lookup", description: "Look up", schema: z.object({}) });
const script = () =>
  fakeModel()
    .respondWithTools([{ name: "lookup", args: {}, id: "call_l" }])
    .respond(new AIMessage("Here it is."));

{
  // #region updates
  const nodes: string[] = [];
  for await (const chunk of await createAgent({ model: script(), tools: [lookup] }).stream(
    { messages: [{ role: "user", content: "Find it" }] },
    { streamMode: "updates" },
  )) {
    nodes.push(...Object.keys(chunk));
  }
  // #endregion
  check(
    JSON.stringify(nodes) === '["model_request","tools","model_request"]',
    `"updates" yields one chunk per step: ${nodes.join(", ")}`,
  );
}
{
  const sizes: number[] = [];
  for await (const state of await createAgent({ model: script(), tools: [lookup] }).stream(
    { messages: [{ role: "user", content: "Find it" }] },
    { streamMode: "values" },
  )) {
    sizes.push(state.messages.length);
  }
  check(
    sizes.at(-1) === 4 && sizes.every((n, i) => i === 0 || n >= sizes[i - 1]),
    `"values" yields growing full states: ${sizes.join(", ")}`,
  );
}
