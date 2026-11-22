// Capstone: a support-triage agent that combines the pieces from examples 01-06.
//   - custom in-process tools (lookup is read-only, escalation needs approval)
//   - a locked-down tool surface (no built-in tools at all)
//   - a PreToolUse audit hook
//   - canUseTool as the human-approval step for the risky tool
//   - typed structured output, turn and budget caps
// Docs: custom-tools.md, permissions.md, hooks.md, structured-outputs.md, agent-loop.md
import { createSdkMcpServer, type HookCallback, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { check, collect } from "./lib/collect.ts";
import { assertOnlyTools, modelRequests } from "./lib/mock-log.ts";

// 1. Tools: plain async functions with Zod input schemas.
const tickets = createSdkMcpServer({
  name: "support",
  version: "1.0.0",
  tools: [
    tool(
      "lookup_customer",
      "Look up a customer's plan and open tickets by email",
      { email: z.string().email() },
      async ({ email }) => ({
        content: [{ type: "text", text: JSON.stringify({ email, plan: "pro", openTickets: 2 }) }],
      }),
      { annotations: { readOnlyHint: true } }, // read-only tools may run in parallel
    ),
    tool("escalate", "Escalate a ticket to the on-call engineer", { reason: z.string() }, async () => ({
      content: [{ type: "text", text: "escalated" }],
    })),
  ],
});

// 2. Output contract: the agent must answer with this shape.
const Triage = z.object({
  category: z.enum(["bug", "billing", "question"]),
  priority: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

// 3. Audit every tool call before it runs.
const audit: string[] = [];
const auditHook: HookCallback = async (input) => {
  if (input.hook_event_name === "PreToolUse") audit.push(input.tool_name);
  return {}; // no decision: let the permission flow continue
};

const approvals: string[] = [];
const { result } = await collect(
  query({
    prompt: "Customer user@example.com says checkout fails with a 500. Triage it.",
    options: {
      systemPrompt: "You are a support triage agent. Call lookup_customer first, then classify the issue.",
      tools: [], // no built-in tools (no Bash, Read, Edit...)
      mcpServers: { support: tickets },
      // #region gate
      allowedTools: ["mcp__support__lookup_customer"], // auto-approve the read-only tool only
      canUseTool: async (toolName, input) => {
        // everything else asks "a human"
        approvals.push(toolName);
        return toolName === "mcp__support__escalate" // book:note gate
          ? { behavior: "deny", message: "Escalation needs a human; classify only." }
          : { behavior: "allow", updatedInput: input };
      },
      // #endregion
      hooks: { PreToolUse: [{ hooks: [auditHook] }] },
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(Triage, { target: "draft-7" }) },
      maxTurns: 6,
      maxBudgetUsd: 0.5,
      settingSources: [], // ignore ~/.claude and project settings
    },
  }),
);

check(audit.includes("mcp__support__lookup_customer"), "PreToolUse hook saw the lookup tool call");
assertOnlyTools(modelRequests(), ["mcp__support__*", "StructuredOutput", "DeferredToolPlaceholder"]); // `tools: []` removed every built-in
check(approvals.length === 0, "auto-approved lookup never reached canUseTool");
check(result?.subtype === "success", "agent finished successfully");
const triage = Triage.safeParse(result?.subtype === "success" ? result.structured_output : undefined);
check(triage.success, "structured_output matches the Triage schema");
console.log("triage:", JSON.stringify(triage.data));
