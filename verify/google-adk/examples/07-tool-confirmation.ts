// Human-in-the-loop tool confirmation: FunctionTool's requireConfirmation (a boolean or a predicate over the
// arguments) pauses the call with an adk_request_confirmation long-running call, the tool body does not run,
// and the app resumes by sending a functionResponse for that call id with {confirmed}. A rejection never
// runs the tool. The docs say TypeScript has no such option and must implement confirmation by hand inside
// execute() (docs/tools-custom/confirmation.md:48-54 and the note at :80); 2.5.0 has it.

import { FunctionTool, InMemoryRunner, LlmAgent, REQUEST_CONFIRMATION_FUNCTION_CALL_NAME } from "@google/adk";
import type { Content } from "@google/genai";
import { z } from "zod";
import { afterTool, calls, callTool, check, responses, ScriptedLlm, say, turn } from "./lib/check.ts";

const paid: number[] = [];
const reimburse = new FunctionTool({
  name: "reimburse",
  description: "Reimburse an amount.",
  parameters: z.object({ amount: z.number() }),
  requireConfirmation: ({ amount }) => amount > 100,
  execute: ({ amount }) => {
    paid.push(amount);
    return { status: "paid", amount };
  },
});

let amount = 500;
const model = new ScriptedLlm((req) => (afterTool(req) ? say("summary") : callTool("reimburse", { amount })));
const agent = new LlmAgent({ name: "finance", model, instruction: "Reimburse.", tools: [reimburse] });
const runner = new InMemoryRunner({ agent, appName: "fin" });
const newSession = async () => (await runner.sessionService.createSession({ appName: "fin", userId: "u1" })).id;
const confirmation = (id: string | undefined, confirmed: boolean): Content => ({
  role: "user",
  parts: [{ functionResponse: { id, name: REQUEST_CONFIRMATION_FUNCTION_CALL_NAME, response: { confirmed } } }],
});

check(
  REQUEST_CONFIRMATION_FUNCTION_CALL_NAME === "adk_request_confirmation",
  "the confirmation call is named adk_request_confirmation",
);

// Approve.
{
  const sid = await newSession();
  const first = await turn(runner, sid, "reimburse 500");
  const request = calls(first).find((c) => c.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME);
  check(request !== undefined && paid.length === 0, "a call that needs confirmation pauses before the tool body runs");
  check(
    first.some((e) => e.longRunningToolIds?.includes(String(request?.id))),
    "the confirmation request is a long-running call",
  );
  check(
    (request?.args as any)?.originalFunctionCall?.args?.amount === 500,
    "the request carries the original call and its arguments",
  );
  check(model.requests.length === 1, "the paused turn makes no further model call");
  const second = await turn(runner, sid, confirmation(request?.id, true));
  check(JSON.stringify(paid) === "[500]", "confirmed: true runs the tool with the original arguments");
  check(
    responses(second)[0]?.response?.status === "paid" && second.at(-1)?.content?.parts?.[0]?.text === "summary",
    "the result goes to the model, which answers",
  );
}

// Reject.
{
  const sid = await newSession();
  const first = await turn(runner, sid, "reimburse 500");
  const request = calls(first).find((c) => c.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME);
  const second = await turn(runner, sid, confirmation(request?.id, false));
  check(Number(paid.length) === 1, "confirmed: false never runs the tool");
  check(
    responses(second)[0]?.response?.error === "This tool call is rejected.",
    "the model sees a rejection error as the tool result",
  );
}

// The predicate: a small amount runs without asking.
{
  amount = 40;
  const events = await turn(runner, await newSession(), "reimburse 40");
  check(
    !calls(events).some((c) => c.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME) && paid.at(-1) === 40,
    "requireConfirmation's predicate can let a call through",
  );
}

// A confirmation for a call id that was never requested does not run anything.
{
  amount = 900;
  const sid = await newSession();
  await turn(runner, sid, "reimburse 900");
  const before = paid.length;
  const forged = await turn(runner, sid, confirmation("adk-forged-id", true));
  check(paid.length === before, "a confirmation with an unknown call id does not run the tool");
  check(
    calls(forged).some((c) => c.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME),
    "instead the turn starts over and the tool asks for confirmation again",
  );
}
