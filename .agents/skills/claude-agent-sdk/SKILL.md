---
name: claude-agent-sdk
description: Use when writing, reviewing or testing TypeScript that imports `@anthropic-ai/claude-agent-sdk` (query(), tool(), createSdkMcpServer, canUseTool, hooks, outputFormat, sessions). Gives the verified setup, the permission order, the gotchas from our fact-check, and how to test offline against a mock Messages API.
---

# Claude Agent SDK (`@anthropic-ai/claude-agent-sdk@0.3.327`)

The SDK runs Claude Code's CLI as a subprocess, and the CLI owns the loop, the tools and the transcripts. You build a safe agent by narrowing what the CLI may do: remove built-in tools, auto-approve only read-only tools, gate the rest, and cap every run. Full reference: [`docs/reference/claude-agent-sdk/guide.md`](../../../docs/reference/claude-agent-sdk/guide.md); verified examples: [`verify/claude-agent-sdk/examples/`](../../../verify/claude-agent-sdk/examples/).

## When to use it

Choose it for a coding- or filesystem-shaped agent when Claude-only models are acceptable and one CLI subprocess per session (about 1 GiB RAM) is affordable. Choose the OpenAI Agents SDK or the Vercel AI SDK for multi-provider agents, and Pi when you must own the loop ([comparison](../../../docs/comparison/deep-comparison.md)).

## Minimal setup

```bash
pnpm add @anthropic-ai/claude-agent-sdk zod   # keep optional deps on: the CLI binary is one; in this repo: pnpm only
export ANTHROPIC_API_KEY=...                     # the SDK ignores .env files
```

```ts
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const support = createSdkMcpServer({
  name: "support", version: "1.0.0",
  tools: [
    tool("lookup_customer", "Look up a customer by email", { email: z.string().email() },
      async ({ email }) => ({ content: [{ type: "text", text: JSON.stringify({ email, plan: "pro" }) }] }),
      { annotations: { readOnlyHint: true } }),
    tool("escalate", "Escalate to on-call", { reason: z.string() },
      async () => ({ content: [{ type: "text", text: "escalated" }] })),
  ],
});
const Triage = z.object({ category: z.enum(["bug", "billing", "question"]), summary: z.string() });

try {
  for await (const m of query({ prompt: "Triage: checkout fails for user@example.com", options: {
    tools: [],                                        // remove Bash, Edit, Read, …
    settingSources: [],                               // ignore ~/.claude and project settings
    mcpServers: { support },
    allowedTools: ["mcp__support__lookup_customer"],  // auto-approve the read-only tool only (emits the
                                                      // SHADOWED warning for it; canUseTool still gates escalate)
    canUseTool: async (name, input) => name === "mcp__support__escalate"
      ? { behavior: "deny", message: "Needs a human" }
      : { behavior: "allow", updatedInput: input },
    outputFormat: { type: "json_schema", schema: z.toJSONSchema(Triage, { target: "draft-7" }) },
    maxTurns: 6, maxBudgetUsd: 0.5,
  } })) {
    if (m.type === "result" && m.subtype === "success") console.log(m.structured_output);
  }
} catch (e) { /* error results also throw after the result message */ }
```

## Patterns that hold (verified)

- **Read `result.subtype` first.** `success` carries `result` and `structured_output`; `error_max_turns`, `error_max_budget_usd`, `error_during_execution` and `error_max_structured_output_retries` don't. Every subtype carries `session_id`, `total_cost_usd` and `usage`.
- **Tools are MCP tools.** The model sees `mcp__<server>__<tool>`, and handlers get Zod-validated arguments.
- **Permission order:** `PreToolUse` hooks → deny rules (`disallowedTools`; win even in `bypassPermissions`) → ask rules → permission mode → allow rules (`allowedTools`) → `canUseTool`. A hook's `{}` defers to the next step; a hook's `allow` doesn't skip deny rules.
- **`tools` vs `allowedTools` vs `disallowedTools`:** `tools` decides which built-ins exist; `allowedTools` auto-approves; `disallowedTools` removes and denies.
- **Sessions:** pass `result.session_id` as `resume` to continue with full history.
- **`result.permission_denials`** is the authoritative record of denied calls; assert on it to prove a gate fired.
- **To gate every call**, use a hook instead of `canUseTool`:

  ```ts
  hooks: { PreToolUse: [{ matcher: "mcp__support__escalate", hooks: [async () => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Needs a human" },
  })] }] },
  ```

## Gotchas (from the fact-check)

- **Zod 4 emits draft 2020-12.** Pass `{ target: "draft-7" }` to `z.toJSONSchema`, or the CLI exits with code 1.
- **A single-shot `query()` throws after it yields an error result.** Wrap the loop in `try`.
- **`canUseTool` is shadowed** for tools listed bare in `allowedTools` and in `bypassPermissions`; the only signal is the Node warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`. Use a `PreToolUse` hook to gate every call.
- **The CLI inherits your environment.** Pass an allowlisted `env` (PATH, HOME, the API key) and audit the `init` message's `tools`.
- **`maxTurns` counts the final answer**, and `maxBudgetUsd` acts only after the response that crosses it.
- **A missing `cwd`** fails with a misleading "native binary … failed to launch … libc" error. Check that `cwd` exists first.
- **`interrupt()` on a finished query rejects**; inside a timer that crashes the process. Catch it.
- **MCP tools can be deferred** behind tool search: the model then calls `ToolSearch` with `select:<name>` before the tool. Deferral depends on the setup; with `tools: []`, the CLI offered MCP tools upfront in our tests. A mock model must handle both (`ENABLE_TOOL_SEARCH` in `env` controls it).
- **Sessions live on local disk** under `~/.claude/projects/`; configure a `sessionStore` for anything a user may resume.

## Test offline

The SDK has no mock model, so tests point `ANTHROPIC_BASE_URL` at the mock Messages API in [`verify/claude-agent-sdk/scripts/mock-anthropic.mjs`](../../../verify/claude-agent-sdk/scripts/mock-anthropic.mjs). The mock calls one `mcp__` tool per query (one the prompt names, else the first offered), then answers, through `StructuredOutput` when a schema is set; test a second tool with a second query whose prompt names it. The runner `node scripts/run-examples.mjs <dir> --only <name>` (from `verify/claude-agent-sdk`) starts a mock per file, runs it in a temp cwd, and sets an allowlisted environment (`ANTHROPIC_BASE_URL`, a fake key, `HOME`, `CLAUDE_CONFIG_DIR`, `MOCK_LOG`, `NO_PROXY`, …). Inside the file, pass those through to the CLI with `env: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }`. Drain the query with `collect()` (`import { collect } from "../examples/lib/collect.ts"`). The runner prints only the outcome; exit 0 is a pass. Run the verified examples with:

```bash
pnpm --filter @buildanagent/verify-claude-agent-sdk test
```
