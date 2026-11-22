// A tool call that no rule allows is refused when nobody can be asked: it never runs, the model reads the refusal as
// an error result, and the SDK records the call in the result's permission_denials. A call a rule allows runs and
// leaves no record.
// Docs: permissions.md "How permissions are evaluated", agent-loop.md "Handle the result"
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { check, collect } from "./lib/collect.ts";
import { modelRequests } from "./lib/mock-log.ts";

const ran = { read: 0, send: 0 };
const mail = createSdkMcpServer({
  name: "mail",
  version: "1.0.0",
  tools: [
    tool("send_email", "Send an email", { to: z.string(), body: z.string() }, async () => {
      ran.send++;
      return { content: [{ type: "text", text: "sent" }] };
    }),
  ],
});
const notes = createSdkMcpServer({
  name: "notes",
  version: "1.0.0",
  tools: [
    tool("read_notes", "Read the private notes", {}, async () => {
      ran.read++;
      return { content: [{ type: "text", text: "notes: the launch code is 1234" }] };
    }),
  ],
});

// #region refusal
// No rule allows send_email and there is no canUseTool callback to ask, so the SDK refuses the call.
const { result } = await collect(
  query({
    prompt: "Call send_email to send the notes to ops@example.com.", // book:note prompt
    options: { mcpServers: { mail }, maxTurns: 4 }, // book:note no-rule
  }),
);
// #endregion
// #region refusal-checks
check(ran.send === 0, "the refused send_email never ran");
check(result?.subtype === "success", "the run still ends in a result: a refusal is not an error"); // book:note result
const denials = result?.permission_denials ?? [];
check(denials.length === 1, "the result records one refused call"); // book:note record
check(denials[0]?.tool_name === "mcp__mail__send_email", "the record names the refused tool");
check(denials[0] !== undefined && "to" in denials[0].tool_input, "the record keeps the refused call's input");
const refusal = modelRequests()
  .flatMap((request) => request.blocks)
  .find((block) => block.type === "tool_result" && block.tool_use_id === denials[0]?.tool_use_id);
check(refusal?.is_error === true, "the model's next request carries the refusal as an error result"); // book:note model
// #endregion

// A call that a rule allows runs, and the result records no refusal.
const allowed = await collect(
  query({
    prompt: "Read the notes.",
    options: { mcpServers: { notes }, allowedTools: ["mcp__notes__read_notes"], maxTurns: 4 },
  }),
);
check(ran.read === 1, "the allowed read_notes ran");
check(allowed.result?.permission_denials.length === 0, "an allowed call leaves permission_denials empty");
