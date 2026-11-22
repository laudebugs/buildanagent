// Human-in-the-loop: a tool that needs approval pauses the run; the state is serialised,
// restored, approved or rejected, and the run resumes.
// Docs: guides/human-in-the-loop.mdx, examples/docs/human-in-the-loop/index.ts
import { Agent, RunState, tool } from "@openai/agents";
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";
import { z } from "zod";
import { check, runner } from "./lib/check.ts";

function setup() {
  const executed: string[] = [];
  // #region needs-approval
  const refund = tool({
    name: "issue_refund",
    description: "Refund an order",
    parameters: z.object({ orderId: z.string() }),
    needsApproval: async () => true, // book:note rule
    execute: async ({ orderId }) => {
      executed.push(orderId);
      return `refunded ${orderId}`;
    },
  });
  // #endregion
  // #region scripted-model
  const model = new ScriptedModel([
    [functionCall("issue_refund", { orderId: "A-1" }, { callId: "call_refund" })], // book:note first-turn
    [assistantMessage("Done.")], // book:note second-turn
  ]);
  // #endregion
  const agent = new Agent({ name: "Refunds", model, tools: [refund] });
  return { agent, model, executed };
}

// a) Approve.
{
  const { agent, model, executed } = setup();
  // #region approve-resume
  const first = await runner.run(agent, "Refund order A-1"); // book:note pause
  check(
    first.interruptions.length === 1 && first.interruptions[0].name === "issue_refund",
    "the run pauses with one interruption",
  );
  check(executed.length === 0, "the tool does not execute before approval");
  const saved = JSON.stringify(first.state); // book:note save
  const state = await RunState.fromString(agent, saved);
  state.approve(first.interruptions[0]); // book:note resume
  const resumed = await runner.run(agent, state);
  // #endregion
  check(JSON.stringify(executed) === JSON.stringify(["A-1"]), "after approve() and resume, the tool executes once");
  check(resumed.finalOutput === "Done.", "the resumed run finishes");
  model.assertComplete();
}
// b) Reject.
{
  const { agent, executed } = setup();
  const first = await runner.run(agent, "Refund order A-1");
  const state = await RunState.fromString(agent, JSON.stringify(first.state));
  state.reject(first.interruptions[0]);
  const resumed = await runner.run(agent, state);
  check(executed.length === 0, "after reject(), the tool never executes");
  check(resumed.finalOutput === "Done.", "the model receives the rejection and still finishes");
}
