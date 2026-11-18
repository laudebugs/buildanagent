// Capstone: a support-triage agent with no built-in tools, a read-only lookup whose customer identity
// comes from trusted context (never from model arguments), a gated escalation that runs only after a
// human approves it out of band, and a typed, Zod-validated result.
// Behaviors: availableTools custom:* (no shell or file tools), skipPermission on the read-only tool,
// { kind: "no-result" } leaving a permission request pending, permissions.handlePendingPermissionRequest
// resolving it later, and sendAndWait(prompt, schema) parsing the final JSON.
// Docs: nodejs/README.md "Tools", "Skipping Permission Prompts", "Permission Result Kinds",
// "Structured output (preview)"; generated rpc.d.ts permissions.handlePendingPermissionRequest.
import { CopilotClient, defineTool, type PermissionRequestedEvent, ToolSet } from "@github/copilot-sdk";
import { z } from "zod";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

// Trusted context: set by our auth layer, closed over by the tools, never shown to the model as a parameter.
const customer = { id: "cust-42", name: "Ada" };
const ORDERS: Record<string, string[]> = { "cust-42": ["A-100 shipped"], "cust-evil": ["B-1 someone else's order"] };

const lookedUp: string[] = [];
const lookupOrders = defineTool("lookup_orders", {
  description: "List the current customer's orders",
  parameters: z.object({}),
  skipPermission: true, // read-only
  handler: async () => {
    lookedUp.push(customer.id);
    return ORDERS[customer.id].join("; ");
  },
});
const escalations: string[] = [];
const escalated = () => escalations.length; // a function, so assertions don't narrow the count
const escalate = defineTool("escalate_to_human", {
  description: "Hand the conversation to a human agent",
  parameters: z.object({ reason: z.string() }),
  handler: async ({ reason }) => {
    escalations.push(`${customer.id}: ${reason}`);
    return "Escalated; a human will reply within a day.";
  },
});
const Triage = z.object({
  category: z.enum(["shipping", "billing", "other"]),
  escalated: z.boolean(),
  summary: z.string(),
});

const client = new CopilotClient({ useLoggedInUser: false });
const session = await client.createSession({
  model: MODEL,
  provider: mockProvider(),
  tools: [lookupOrders, escalate],
  availableTools: new ToolSet().addCustom("*"),
  systemMessage: { mode: "append", content: `You are helping ${customer.name}. Escalate only when needed.` },
  // Escalation waits for a human; anything else that asks is refused.
  onPermissionRequest: (request) =>
    request.kind === "custom-tool" && request.toolName === "escalate_to_human"
      ? { kind: "no-result" }
      : { kind: "reject", feedback: "Not allowed in triage." },
});

// The human approval queue: a reviewer decides each pending escalation out of band.
let decide: "approve" | "reject" = "reject";
const reviewed: string[] = [];
session.on("permission.requested", (event: PermissionRequestedEvent) => {
  const req = event.data.permissionRequest;
  reviewed.push(req.kind === "custom-tool" ? req.toolName : req.kind);
  setTimeout(() => {
    void session.rpc.permissions.handlePendingPermissionRequest({
      requestId: event.data.requestId,
      result: decide === "approve" ? { kind: "approve-once" } : { kind: "reject", feedback: "Reviewer declined." },
    });
  }, 200);
});

const prompt = (reply: object) =>
  [
    "My parcel is late. Use lookup_orders, then escalate_to_human.",
    'mock-args lookup_orders {"customerId":"cust-evil"}',
    'mock-args escalate_to_human {"reason":"late parcel"}',
    `mock-reply: ${JSON.stringify(reply)}`,
  ].join("\n");

// Run 1: the reviewer declines.
const first = await session.sendAndWait(
  prompt({ category: "shipping", escalated: false, summary: "Order A-100 shipped." }),
  Triage,
  60_000,
);
check(
  lookedUp.length === 1 && lookedUp[0] === "cust-42",
  "lookup used the trusted customer id, not the model's argument",
);
const lookupDecl = mockRequests()[0].body.tools.find((t: any) => t.name === "lookup_orders");
check(
  Object.keys(lookupDecl?.input_schema?.properties ?? {}).length === 0,
  "the lookup tool exposes no identity parameter",
);
check(escalated() === 0, "a declined escalation never ran");
check(JSON.stringify(reviewed) === JSON.stringify(["escalate_to_human"]), "only the escalation reached the reviewer");
check(first.category === "shipping" && first.escalated === false, "the typed result parsed (run 1)");
const offered = mockRequests()[0].tools ?? [];
check(
  JSON.stringify([...offered].sort()) === JSON.stringify(["escalate_to_human", "lookup_orders"]),
  `no built-in tools offered (${offered})`,
);

// Run 2: the reviewer approves.
decide = "approve";
const second = await session.sendAndWait(
  prompt({ category: "shipping", escalated: true, summary: "Escalated the late parcel." }),
  Triage,
  60_000,
);
check(escalated() === 1 && escalations[0] === "cust-42: late parcel", "an approved escalation ran once");
check(second.escalated === true, "the typed result parsed (run 2)");

const bad = await session
  .sendAndWait(
    'Answer badly.\nmock-no-tools\nmock-reply: {"category":"weather","escalated":false,"summary":"x"}',
    Triage,
    60_000,
  )
  .then(
    () => "parsed",
    (e: Error) => e.name,
  );
check(bad !== "parsed", `a result that fails the schema throws (${bad})`);
check(escalated() === 1, "no further escalation ran");

await session.disconnect();
await client.stop();
