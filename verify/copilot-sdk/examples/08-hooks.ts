// Behavior: hooks.onPreToolUse runs before onPermissionRequest and can deny a call outright, so the
// handler and the permission callback never run; onPostToolUse can replace the result the model
// sees. Returning null, as docs/hooks/*.md do, is accepted at runtime although the types say void.
// Docs: docs/hooks/pre-tool-use.md, docs/hooks/post-tool-use.md, docs/hooks/hooks-overview.md.
import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { check, MODEL, mockProvider, mockRequests } from "./lib/harness.ts";

const ran: string[] = [];
const order: string[] = [];
const closeTicket = defineTool("close_ticket", {
  description: "Close a ticket",
  handler: () => {
    ran.push("close_ticket");
    return "closed";
  },
});
const readTicket = defineTool("read_ticket", {
  description: "Read a ticket",
  handler: () => {
    ran.push("read_ticket");
    return "raw ticket body";
  },
});

const client = new CopilotClient({ useLoggedInUser: false });
const session = await client.createSession({
  model: MODEL,
  provider: mockProvider(),
  tools: [closeTicket, readTicket],
  onPermissionRequest: (request) => {
    order.push(`permission:${request.kind === "custom-tool" ? request.toolName : request.kind}`);
    return { kind: "approve-once" };
  },
  // #region hooks
  hooks: {
    onPreToolUse: async (input) => {
      order.push(`pre:${input.toolName}`);
      if (input.toolName === "close_ticket")
        return { permissionDecision: "deny", permissionDecisionReason: "Closing needs a supervisor." }; // book:note deny
      return null as unknown as undefined; // what the docs return; typed as void // book:note pass
    },
    onPostToolUse: async (input) => {
      order.push(`post:${input.toolName}`);
      if (input.toolName === "read_ticket")
        return { modifiedResult: { ...input.toolResult, textResultForLlm: "ticket body (redacted)" } }; // book:note replace
      return null as unknown as undefined;
    },
  },
  // #endregion
});
await session.sendAndWait({ prompt: "Use close_ticket, then read_ticket.\nmock-reply: Done." });

check(!ran.includes("close_ticket"), "the denied tool's handler never ran");
check(ran.includes("read_ticket"), "the allowed tool ran");
check(!order.includes("permission:close_ticket"), "onPermissionRequest was not asked for the denied tool");
check(
  order.indexOf("pre:read_ticket") < order.indexOf("permission:read_ticket"),
  "onPreToolUse runs before onPermissionRequest",
);
const sent = JSON.stringify(mockRequests().map((r) => r.body.messages.at(-1)));
check(sent.includes("Closing needs a supervisor."), "the model saw the deny reason");
check(
  sent.includes("ticket body (redacted)") && !sent.includes("raw ticket body"),
  "onPostToolUse replaced the result",
);
console.log("order:", order.join(", "));
await session.disconnect();
await client.stop();
