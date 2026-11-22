// A tool that declares no identity field, on our SDK. The customer comes from the run's `app` option, which the app
// builds from each request's signed-in session; the model cannot write it, and the SDK sends it to no model request.
// The book's Chapter 3 lists the region beside the same idea in Google ADK.
import type { Model } from "@buildanagent/gateway";
import { defineTool, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const customers: Record<string, { name: string; plan: string; openTickets: number }> = {
  "cust-42": { name: "Ada", plan: "pro", openTickets: 2 },
  "cust-7": { name: "Bob", plan: "team", openTickets: 5 },
};
const lookups: string[] = [];

// #region lookup-customer
/** What the auth layer knows about the signed-in user of one request. */
interface Session {
  readonly customerId: string;
}

const lookupCustomer = defineTool<Record<string, never>, unknown, Session>({
  name: "lookup_customer",
  description: "Look up the signed-in customer's plan and open tickets.",
  inputSchema: z.object({}), // book:note no-identity
  async execute(input, ctx) {
    if (ctx.app === undefined) throw new Error("no signed-in customer"); // book:note from-app
    const { customerId } = ctx.app;
    lookups.push(`${customerId} input=${JSON.stringify(input)}`);
    const record = { customerId, ...customers[customerId] };
    return { content: [{ type: "text", text: JSON.stringify(record) }] };
  },
});

/** One run for one request: its `app` comes from that request's session, never from a shared variable. */
function answerFor(session: Session, model: Model, input: string) {
  return run({ model, system: "You help support customers.", input, tools: [lookupCustomer], app: session }); // book:note per-request
}
// #endregion

/** A model that, like a model steered by a ticket, asks for another customer's record. */
function steered(asks: string, answer: string) {
  return scripted([
    { content: [{ type: "tool_call", callId: "call-1", name: "lookup_customer", input: { customerId: asks } }] },
    { content: [{ type: "text", text: answer }] },
  ]);
}

const adaSession: Session = { customerId: "cust-42" };
const bobSession: Session = { customerId: "cust-7" };
const ada = steered("cust-7", "Ada, you are on the pro plan.");
const adaRun = await answerFor(adaSession, ada.model, "Check bob@example.com too.").result;
// A second request, from another signed-in user, builds its own session and its own run.
const bob = steered("cust-42", "Bob, you are on the team plan.");
await answerFor(bobSession, bob.model, "What is my plan?").result;

const offered = ada.adapter.calls[0]?.context.tools[0];
const schema = offered?.inputSchema as { properties?: object } | undefined;
check(
  Object.keys(schema?.properties ?? { missing: true }).length === 0,
  "the model is offered a tool with no field in which to name a customer",
);
check(adaRun.stopReason === "done" && adaRun.steps === 2, "the run answers after one lookup");
check(
  lookups[0] === "cust-42 input={}",
  "the lookup ran for the signed-in customer, and the id the model sent was dropped from its input",
);
const result = ada.adapter.calls[1]?.context.messages.find((message) => message.role === "tool");
const text = result?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
check(JSON.parse(text).name === "Ada", "the result holds the signed-in customer's record");
check(!JSON.stringify(ada.adapter.calls).includes("Bob"), "the other customer's record never reaches the model");
check(lookups[1] === "cust-7 input={}", "the next request's run read its own session's customer");
check(
  !JSON.stringify(bob.adapter.calls).includes("Ada"),
  "the first request's customer never reaches the second request",
);
// The app object, as JSON and as it would read inside a string, appears in no request either run sent. The tool's
// own result carries the customer's id inside a longer record, which neither form matches.
for (const [name, session, calls] of [
  ["Ada's", adaSession, ada.adapter.calls],
  ["Bob's", bobSession, bob.adapter.calls],
] as const) {
  const asJson = JSON.stringify(session);
  const asText = JSON.stringify(asJson).slice(1, -1);
  const sent = JSON.stringify(calls);
  check(!sent.includes(asJson) && !sent.includes(asText), `the app data reaches none of ${name} requests`);
}
ada.adapter.assertComplete();
bob.adapter.assertComplete();
