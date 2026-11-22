// Capstone: a support-triage agent on Pi, the counterpart of verify/claude-agent-sdk/examples/07.
//   - no built-in tools (noTools: "builtin"), only our own tools
//   - a read-only lookup tool and a risky escalate tool
//   - an inline extension that audits every call and blocks escalation (Pi's only gate)
//   - typed output through a terminating submit tool (Pi's structured-output pattern)
//   - in-memory session and settings, so nothing touches ~/.pi
// Docs: sdk.md, extensions.md ("tool_call", "Structured output", examples/extensions/structured-output.ts)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, defineTool } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { check, fauxAssistantMessage, fauxSession, fauxToolCall } from "./lib/faux.ts";

// 1. Tools.
const lookupCustomer = defineTool({
  name: "lookup_customer",
  label: "Lookup",
  description: "Look up a customer's plan and open tickets by email",
  parameters: Type.Object({ email: Type.String() }),
  execute: async (_id, { email }) => ({
    content: [{ type: "text", text: JSON.stringify({ email, plan: "pro", openTickets: 2 }) }],
    details: {},
  }),
});
const escalate = defineTool({
  name: "escalate",
  label: "Escalate",
  description: "Escalate a ticket to the on-call engineer",
  parameters: Type.Object({ reason: Type.String() }),
  execute: async () => ({ content: [{ type: "text", text: "escalated" }], details: {} }),
});

// 2. Output contract, captured by a tool that ends the run.
const Triage = Type.Object({
  category: Type.Union([Type.Literal("bug"), Type.Literal("billing"), Type.Literal("question")]),
  priority: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
  summary: Type.String(),
});
let triage: Static<typeof Triage> | undefined;
const submitTriage = defineTool({
  name: "submit_triage",
  label: "Submit triage",
  description: "Submit the final triage result. Call this last.",
  parameters: Triage,
  execute: async (_id, params) => {
    triage = params;
    return { content: [{ type: "text", text: "triage recorded" }], details: params, terminate: true };
  },
});

// 3. The gate: an inline extension sees every tool call before it runs.
const audit: string[] = [];
const cwd = mkdtempSync(join(tmpdir(), "pi-triage-"));
// #region gate
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir: join(cwd, ".pi-agent"),
  extensionFactories: [
    (pi) => {
      pi.on("tool_call", async (event) => {
        audit.push(event.toolName);
        if (event.toolName === "escalate") return { block: true, reason: "Escalation needs a human." }; // book:note gate
        return undefined;
      });
    },
  ],
});
// #endregion
await resourceLoader.reload();

// The faux model plays a model that looks up, tries to escalate, then submits.
// #region faux-script
const { session, faux } = await fauxSession(
  [
    fauxAssistantMessage([fauxToolCall("lookup_customer", { email: "user@example.com" })], { stopReason: "toolUse" }), // book:note first-turn
    fauxAssistantMessage([fauxToolCall("escalate", { reason: "checkout 500" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(
      [fauxToolCall("submit_triage", { category: "bug", priority: "high", summary: "Checkout returns 500." })],
      { stopReason: "toolUse" },
    ),
  ],
  { cwd, resourceLoader, noTools: "builtin", customTools: [lookupCustomer, escalate, submitTriage] },
);
// #endregion

try {
  check(
    JSON.stringify(session.getActiveToolNames().sort()) ===
      JSON.stringify(["escalate", "lookup_customer", "submit_triage"]),
    'noTools: "builtin" leaves only our three tools',
  );
  await session.prompt("user@example.com gets a 500 at checkout. Look them up, escalate, then submit the triage.");
  check(
    JSON.stringify(audit) === JSON.stringify(["lookup_customer", "escalate", "submit_triage"]),
    "the extension audited every call in order",
  );
  const blocked = session.messages.find(
    (m) => m.role === "toolResult" && JSON.stringify(m).includes("Escalation needs a human"),
  );
  check(blocked, "escalation was blocked and the reason went back to the model");
  check(triage?.category === "bug" && triage.priority === "high", "submit_triage captured the typed result");
  check(faux.state.callCount === 3, "terminate: true ended the run without an extra model turn");
  console.log("triage:", JSON.stringify(triage));
} finally {
  session.dispose();
}
