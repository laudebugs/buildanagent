// A done tool on our SDK. outputTool() is a tool whose input is the run's answer: when the model calls it with an
// answer that passes its schema, the run ends done and the answer is result.output. A shouldStop hook is the other way
// to end a run on a condition you wrote, and it ends the run stopped. The book's Chapter 4 lists the output tool beside
// the AI SDK's hasToolCall("finalAnswer").
import { defineTool, outputTool, run } from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const ping = defineTool({
  name: "ping",
  description: "Check that the service is up",
  inputSchema: z.object({}),
  async execute() {
    return { content: [{ type: "text", text: "pong" }] };
  },
});
const callTool = (callId: string, name: string, input: unknown): ScriptStep => ({
  content: [{ type: "tool_call", callId, name, input }],
});

{
  // #region done-tool
  const finalAnswer = outputTool({ name: "finalAnswer", schema: z.object({ answer: z.string() }) });
  const { adapter, model } = scripted([
    callTool("call-ping", "ping", {}),
    callTool("call-final", "finalAnswer", { answer: "42" }),
  ]);
  const result = await run({
    model,
    system: "Ping the service, then answer.",
    tools: [ping],
    output: finalAnswer, // book:note done-tool
    maxSteps: 10, // book:note either
    input: "Answer.",
  }).result;
  const answer = result.stopReason === "done" ? result.output?.answer : undefined; // book:note answer
  // #endregion
  check(result.stopReason === "done" && result.steps === 2, "the output tool's call ends the run done after two steps");
  check(adapter.calls.length === 2, "no third request is made, and the strict script would refuse one");
  check(answer === "42", "the answer is result.output, typed by the schema");
  check(
    adapter.calls[0]?.context.tools.map((tool) => tool.name).join() === "ping,finalAnswer",
    "the first request offers both tools: the output tool is sent like any other",
  );
  adapter.assertComplete();
}

// A shouldStop hook ends a run on a condition of your own, here a plain tool call, and the run ends stopped.
{
  const finish = defineTool({
    name: "finish",
    description: "Say the work is done",
    inputSchema: z.object({}),
    async execute() {
      return { content: [{ type: "text", text: "noted" }] };
    },
  });
  const { adapter, model } = scripted([callTool("call-ping", "ping", {}), callTool("call-finish", "finish", {})]);
  const result = await run({
    model,
    system: "Ping the service, then finish.",
    tools: [ping, finish],
    input: "Go.",
    interceptors: {
      shouldStop: ({ lastMessage }) =>
        lastMessage.content.some((block) => block.type === "tool_call" && block.name === "finish")
          ? { stop: "hook", reason: "the model called finish" }
          : false,
    },
  }).result;
  check(
    result.stopReason === "stopped" && result.steps === 2,
    "a shouldStop hook ends the run stopped after two steps",
  );
  check(
    result.stopReason === "stopped" && result.stoppedBy === "the model called finish",
    "stoppedBy is the reason the hook gave",
  );
  adapter.assertComplete();
}
