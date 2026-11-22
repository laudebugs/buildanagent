// Runs the order agent without a model or an API key. A ScriptedModel plays the model's two answers, the first a call
// to lookup_order and the second the reply, so the run gives the same result every time.
import { createModel } from "@buildanagent/gateway";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { answerOrderQuestion } from "./order-agent.js";

const ORDER = 42;

// #region offline
/** Runs the order agent on scripted answers, checks the script ran out, and returns the agent's answer. */
export async function answerOffline(): Promise<string> {
  const adapter = new ScriptedModel([
    { content: [{ type: "tool_call", callId: "call-1", name: "lookup_order", input: { order: ORDER } }] },
    { content: [{ type: "text", text: `Order ${ORDER} has shipped.` }] },
  ]);
  const model = createModel({ adapter, id: "scripted-model" });
  const findOrder = async (id: number) => ({ id, status: "shipped" as const });
  const answer = await answerOrderQuestion(model, findOrder, `Where is order ${ORDER}?`, () => {});
  adapter.assertComplete();
  return answer;
}
// #endregion
