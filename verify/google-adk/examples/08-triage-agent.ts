// Capstone: a gated support-triage agent on ADK.
//   - lookup_customer is read-only and takes the customer's identity from session state (user:customer_id,
//     set by the app when it creates the session), never from a model argument; zod strips any extra
//     argument the model invents.
//   - escalate_to_human uses requireConfirmation, so it never runs until a human approves the call id.
//   - The result is typed: outputSchema + outputKey, re-validated with zod by the app, because ADK only
//     logs a schema violation (see 06-structured-output.ts).
//   - A beforeToolCallback denies host tools by name as a second line of defence.
import type { Context } from "@google/adk";
import { FunctionTool, InMemoryRunner, LlmAgent, REQUEST_CONFIRMATION_FUNCTION_CALL_NAME } from "@google/adk";
import type { Content } from "@google/genai";
import { z } from "zod";
import { afterTool, calls, callTool, check, lastParts, ScriptedLlm, turn } from "./lib/check.ts";

const CUSTOMERS: Record<string, { name: string; plan: string; openTickets: number }> = {
  "cust-42": { name: "Ada", plan: "pro", openTickets: 2 },
  "cust-999": { name: "Mallory", plan: "enterprise", openTickets: 0 },
};
const lookups: string[] = [];
const escalations: string[] = [];

// #region lookup-customer
const lookupCustomer = new FunctionTool({
  name: "lookup_customer",
  description: "Look up the current customer's plan and open tickets.",
  parameters: z.object({}), // book:note no-identity
  execute: (args, ctx?: Context) => {
    const id = ctx?.state.get<string>("user:customer_id"); // book:note from-state
    lookups.push(`${id} args=${JSON.stringify(args)}`);
    return id && CUSTOMERS[id] ? { customerId: id, ...CUSTOMERS[id] } : { error: "no customer in session" };
  },
});
// #endregion lookup-customer
// #region gate
const escalateToHuman = new FunctionTool({
  name: "escalate_to_human",
  description: "Escalate the ticket to a human agent.",
  parameters: z.object({ reason: z.string() }),
  requireConfirmation: true, // book:note gate
  execute: ({ reason }, ctx?: Context) => {
    escalations.push(`${ctx?.state.get("user:customer_id")}: ${reason}`);
    return { status: "escalated", queue: "tier-2" };
  },
});
// #endregion
const TriageResult = z.object({
  category: z.enum(["billing", "bug", "account", "other"]),
  priority: z.number().int().min(1).max(4),
  escalated: z.boolean(),
  summary: z.string(),
});

// The scripted model: look up the customer (trying to smuggle in another id), then escalate, then answer
// through set_model_response. After a rejection it answers with escalated: false.
const model = new ScriptedLlm((req) => {
  const last = lastParts(req)[0]?.functionResponse;
  if (!afterTool(req)) return callTool("lookup_customer", { customerId: "cust-999" });
  if (last?.name === "lookup_customer") return callTool("escalate_to_human", { reason: "double charge on pro plan" });
  const escalated = last?.name === "escalate_to_human" && !(last.response as any)?.error;
  return callTool("set_model_response", { category: "billing", priority: 2, escalated, summary: "Double charge" });
});
const HOST_TOOL = /bash|shell|exec|write|edit|delete|file/i;
const agent = new LlmAgent({
  name: "triage",
  model,
  instruction: "Triage the ticket. Look up the customer first. Escalate billing disputes.",
  tools: [lookupCustomer, escalateToHuman],
  outputSchema: TriageResult,
  outputKey: "triage",
  beforeToolCallback: ({ tool }) =>
    HOST_TOOL.test(tool.name) ? { error: `tool ${tool.name} is not allowed` } : undefined,
});
const runner = new InMemoryRunner({ agent, appName: "support" });
const openTicket = async () =>
  (
    await runner.sessionService.createSession({
      appName: "support",
      userId: "ada",
      state: { "user:customer_id": "cust-42" },
    })
  ).id;
const answer = (id: string | undefined, confirmed: boolean): Content => ({
  role: "user",
  parts: [{ functionResponse: { id, name: REQUEST_CONFIRMATION_FUNCTION_CALL_NAME, response: { confirmed } } }],
});
const triageOf = async (sid: string) =>
  TriageResult.parse(
    (await runner.sessionService.getSession({ appName: "support", userId: "ada", sessionId: sid }))?.state.triage,
  );

// Approved escalation.
{
  const sid = await openTicket();
  const first = await turn(runner, sid, "I was charged twice this month.", "ada");
  check(
    lookups[0] === "cust-42 args={}",
    "lookup_customer reads the identity from session state and drops the model's customerId",
  );
  check(!JSON.stringify(first).includes("Mallory"), "the other customer's record never reaches the model");
  const request = calls(first).find((c) => c.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME);
  check(request !== undefined && escalations.length === 0, "escalate_to_human pauses for approval and has not run");
  await turn(runner, sid, answer(request?.id, true), "ada");
  check(
    escalations.join() === "cust-42: double charge on pro plan",
    "after approval the escalation runs once, for the session's customer",
  );
  const result = await triageOf(sid);
  check(
    result.escalated && result.category === "billing" && result.priority === 2,
    "the typed result parses with zod and records the escalation",
  );
}

// Rejected escalation.
{
  const sid = await openTicket();
  const first = await turn(runner, sid, "I was charged twice this month.", "ada");
  const request = calls(first).find((c) => c.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME);
  await turn(runner, sid, answer(request?.id, false), "ada");
  check(Number(escalations.length) === 1, "a rejected escalation never runs");
  const result = await triageOf(sid);
  check(result.escalated === false, "the typed result says the ticket was not escalated");
}

// A session without an identity gets nothing.
{
  const sid = (await runner.sessionService.createSession({ appName: "support", userId: "anon" })).id;
  const events = await turn(runner, sid, "Who am I?", "anon");
  check(
    JSON.stringify(events).includes("no customer in session"),
    "without user:customer_id in state the lookup returns an error, not a guess",
  );
}

check(
  model.requests.every((r) => !JSON.stringify(r.config?.tools).match(HOST_TOOL)),
  "no host tool is ever offered to the model",
);
