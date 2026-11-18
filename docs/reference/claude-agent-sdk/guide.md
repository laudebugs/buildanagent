# Claude Agent SDK (TypeScript): reference guide

As of November 2026, against `@anthropic-ai/claude-agent-sdk@0.3.327` (bundled Claude Code CLI). Every behavioral claim marked **[verified]** is asserted by a runnable example in [`verify/claude-agent-sdk/examples/`](../../../verify/claude-agent-sdk/examples/), run offline against a mock Anthropic API. Everything else cites the upstream page (`source/<page>.md`, regenerate with `npm run fetch-docs`). The accuracy of the docs themselves is covered in [fact-check.md](fact-check.md).

## 1. What it is

The Agent SDK is "Claude Code as a library". `query()` spawns the bundled `claude` CLI as a subprocess and talks to it over stdio. The subprocess owns the agent loop, the built-in tools, the shell, the working directory and the session transcripts (`hosting.md`). Your code configures the loop and observes it. It does not run the loop itself.

| You want to | Use |
|---|---|
| Embed Claude Code's loop, tools, permissions, sessions and hooks in your app | **Agent SDK** |
| Call the Messages API and write the tool loop yourself | Client SDK (`@anthropic-ai/sdk`) |
| Have Anthropic host the loop and the sandbox | Managed Agents |
| Drive the loop from another language | `claude -p --output-format json` as a subprocess |

(`overview.md`)

Consequences of the subprocess design:
- **One session = one process.** Size hosts at about 1 GiB RAM, 5 GiB disk and 1 CPU per agent as a floor (`hosting.md`).
- **Claude models only:** via the Anthropic API, Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`) or Google Cloud (`quickstart.md`).
- **Licensing.** The package is MIT-labelled, but use is governed by Anthropic's Commercial Terms. Third-party products may not offer claude.ai login without approval, and they must follow the branding rules: "Powered by Claude" is fine, but "Claude Code" and look-alike visuals are not (`overview.md`, `quickstart.md`).

## 2. Install and authenticate

```bash
npm install @anthropic-ai/claude-agent-sdk zod
export ANTHROPIC_API_KEY=...   # the SDK does not load .env files
```

- Requires Node.js 18.14+. The platform binary arrives as an optional dependency (`@anthropic-ai/claude-agent-sdk-linux-x64`, …), so don't install with `--no-optional`.
- The binary is pinned to the SDK version: updating the SDK updates the CLI. Take patch releases freely and read the changelog before a minor (`hosting.md`).
- `ANTHROPIC_BASE_URL` routes model calls through a gateway or proxy. This is also how the verification harness substitutes a mock model. **[verified]**

## 3. The agent loop

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({ prompt: "What files are here?", options: { maxTurns: 5 } })) {
  if (message.type === "result" && message.subtype === "success") console.log(message.result);
}
```

`query()` returns a `Query`: an `AsyncGenerator<SDKMessage>` with control methods. One run goes:

1. `system` message, `subtype: "init"` (session id, tools, model). **[verified: 01]**
2. `assistant` messages (text and `tool_use` blocks) and `user` messages carrying `tool_result`s, one cycle per turn. The loop does not yield control back to you between turns. **[verified: 02]**
3. A final `result` message (`agent-loop.md`).

A **turn** is one model call plus its tool executions. `maxTurns` must count the final text-only turn too, or the run ends in `error_max_turns` (`agent-loop.md`). **[verified: 04]**

### The result message

| `subtype` | Meaning | `result` text? |
|---|---|---|
| `success` | Finished normally | yes **[verified: 01]** |
| `error_max_turns` | Hit `maxTurns` | no **[verified: 04]** |
| `error_max_budget_usd` | Hit `maxBudgetUsd` (checked after each response, so it can overshoot by one response) | no |
| `error_during_execution` | Interrupted or crashed | no |
| `error_max_structured_output_retries` | No schema-valid output | no |

All variants carry `session_id`, `total_cost_usd`, `usage`, `num_turns` and `stop_reason` **[verified: 01, 04]**. `usage` covers only the main loop; use `modelUsage` for the whole tree including subagents.

> **Gotcha.** After an error result, a single-shot `query()` **throws** (for example `Reached maximum number of turns`) *after* yielding the result. Wrap the loop in `try`. **[verified: 04]**

`SDKMessage` is a 40-member union. Beyond the core types it includes streaming deltas (`stream_event`, with `includePartialMessages`), compaction boundaries, hook progress, task and subagent lifecycle, rate-limit events, API retries and refusal fallbacks. Switch on `type`, then `subtype`.

## 4. Options you will actually use

There are 70 top-level `Options` fields (see `typescript.md#options` or `sdk.d.ts`). Grouped:

| Concern | Options |
|---|---|
| Loop limits | `maxTurns`, `maxBudgetUsd`, `effort` (`low` … `max`), `maxThinkingTokens`, `abortController` |
| Model | `model`, `fallbackModel`, `betas` |
| Prompting | `systemPrompt` (string, string[], `{ type: "custom", prompt }`, or `{ type: "preset", preset: "claude_code", … }`), `settingSources` |
| Tools | `tools` (which built-ins exist), `allowedTools` (auto-approve), `disallowedTools` (remove/deny), `mcpServers` |
| Permissions | `permissionMode`, `allowDangerouslySkipPermissions`, `canUseTool`, `permissionPrompts` |
| Extension | `hooks`, `agents` (subagents), `plugins`, `outputFormat` |
| Sessions | `resume`, `continue`, `forkSession`, `sessionStore`, `persistSession` |
| Environment | `cwd`, `additionalDirectories`, `env`, `executable`, `pathToClaudeCodeExecutable` |
| Streaming | `includePartialMessages` |

Three tool options are easy to confuse:
- **`tools`** decides which built-in tools *exist*. `tools: []` removes Bash, Edit, Read and the rest. **[verified: 07]**
- **`allowedTools`** *auto-approves*. It does not restrict.
- **`disallowedTools`** *removes and denies*, even in `bypassPermissions` mode. **[verified: 03c]**

## 5. Custom tools

Tools are in-process MCP servers:

```ts
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const weather = createSdkMcpServer({
  name: "weather", version: "1.0.0",
  tools: [tool("get_temperature", "Get the current temperature at a location",
    { latitude: z.number(), longitude: z.number() },
    async ({ latitude, longitude }) => ({ content: [{ type: "text", text: "21°C" }] }),
    { annotations: { readOnlyHint: true } })],
});

query({ prompt: "Weather in Lisbon?", options: {
  mcpServers: { weather },
  allowedTools: ["mcp__weather__get_temperature"],   // mcp__<server>__<tool>
} });
```

- The handler receives Zod-validated arguments. **[verified: 02]**
- Tool names on the wire are `mcp__<server>__<tool>`. **[verified: 02]**
- Return `isError: true` to control the error text the model sees, `structuredContent` for machine-readable JSON, and `image` or `resource` blocks for files. Set `readOnlyHint` to let calls run in parallel (`custom-tools.md`).
- `permission_policy: "always_ask"` on the server config forces approval even over `allowedTools` (`custom-tools.md`, `permissions.md`).

**Tool search is on by default**, including behind an `ANTHROPIC_BASE_URL` gateway. MCP tool definitions are *deferred*: the model sees only their names and must call `ToolSearch` (`select:<name>`) to load a schema before calling it. **[verified: the mock had to implement this for 02–04 to pass]** Control it with `ENABLE_TOOL_SEARCH` (`true`, `false`, `auto`, `auto:N`) in `env` (`tool-search.md`). With `tools: []`, MCP tools were offered upfront in our runs (07).

## 6. MCP servers

`mcpServers` takes four kinds of config: `{ command, args, env }` (stdio), `{ type: "sse", url, headers }`, `{ type: "http", url, headers }`, and SDK servers from `createSdkMcpServer` (`typescript.md#mcpserverconfig`, `mcp.md`). The `Query` methods `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()` and `setMcpServers()` manage servers at runtime.

## 7. Permissions

Every tool call passes through six steps in order (`permissions.md`):

1. **Hooks.** `PreToolUse` can deny. Its `allow` does *not* skip steps 2–3. **[verified: 03d, 03e]**
2. **Deny rules** (`disallowedTools`, settings). Final, even in `bypassPermissions`, and `canUseTool` is not called. **[verified: 03c]**
3. **Ask rules** (settings `ask`, `always_ask` tools, `AskUserQuestion`). These go to `canUseTool` even in `bypassPermissions`.
4. **Permission mode:** `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions` or `auto`. All six are confirmed in `sdk.d.ts`.
5. **Allow rules** (`allowedTools`, settings). A match approves, and `canUseTool` is never consulted. **[verified: 03b]**
6. **`canUseTool`** decides anything unresolved. **[verified: 03a]** In `dontAsk` mode this step denies instead. **[verified: 03f]**

```ts
canUseTool: async (toolName, input, { signal, suggestions }) =>
  toolName === "mcp__ops__restart_service"
    ? { behavior: "deny", message: "Needs a human" }
    : { behavior: "allow", updatedInput: input },
```

> **Gotcha.** Passing `canUseTool` with a bare tool name in `allowedTools` (or with `bypassPermissions`) emits a Node warning, `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`, because that callback will never run for those calls. To gate *every* call, use a `PreToolUse` hook. **[verified: 03b]**

## 8. Hooks

`hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>`. There are 33 events, and the docs and package agree on the full list. The key ones:
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` and `PermissionDenied`
- `UserPromptSubmit`, `SessionStart`/`SessionEnd`, `Stop`, `SubagentStart`/`SubagentStop`
- `PreCompact`/`PostCompact`, `Notification`

```ts
hooks: {
  PreToolUse: [{
    matcher: "Write|Edit",            // optional; matched against the tool name (exact or regex,
                                      // per the settings-file matcher rules in hooks.md)
    timeout: 30, onFailure: "block",  // seconds; block the action if the callback throws
    hooks: [async (input, toolUseId, { signal }) => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "change freeze" },
    })],
  }],
}
```

A `PreToolUse` hook can also return `updatedInput` to rewrite arguments, and `additionalContext` or `systemMessage` to inform the model (`hooks.md`). Returning `{}` makes no decision. **[verified: 07]**

## 9. Structured output

```ts
const Ticket = z.object({ title: z.string(), priority: z.enum(["low", "medium", "high"]) });
const q = query({ prompt, options: {
  outputFormat: { type: "json_schema", schema: z.toJSONSchema(Ticket, { target: "draft-7" }) },
} });
// result.structured_output holds the validated object (on subtype "success")
```

- The model answers through a `StructuredOutput` tool call, and the value lands on `result.structured_output`. **[verified: 05, 07]**

> **Gotcha.** Without `{ target: "draft-7" }`, Zod 4 emits a draft 2020-12 `$schema` and the CLI process **exits with code 1** (`--json-schema is not a valid JSON Schema`). The docs warn about this (`structured-outputs.md`). **[verified]**

## 10. Sessions

- Every result carries `session_id`. `resume: id` continues that conversation with its full history, keeping the same id. **[verified: 06]**
- `forkSession: true` branches instead, `continue: true` resumes the most recent session in `cwd`, and `resumeSessionAt` rewinds to a message (`sessions.md`).
- **Storage is local by default:** JSONL transcripts under `~/.claude/projects/`, or under `CLAUDE_CONFIG_DIR` if set. They're lost on container restart.
- **`sessionStore`** mirrors transcripts to your own store on a best-effort basis (watch for `mirror_error` messages). It covers transcripts only, not memory files or working-directory artifacts (`hosting.md`, `session-storage.md`).
- **Management functions:** `listSessions`, `getSessionMessages`, `getSessionInfo`, `renameSession`, `tagSession` and `forkSession` are all documented. `archiveSession`, `unarchiveSession` and `deleteSession` exist but are not documented in the reference (see the fact-check).

## 11. Subagents

```ts
agents: {
  reviewer: {
    description: "Reviews diffs for security issues",   // when Claude should delegate
    prompt: "You are a security reviewer...",
    tools: ["Read", "Grep"], model: "sonnet", maxTurns: 10,
  },
},
```

- Claude delegates through the `Agent` tool.
- `AgentDefinition` also takes `disallowedTools` (including `mcp__server__*` patterns), `mcpServers`, `skills`, `background`, `effort`, `permissionMode`, `memory` and `omitClaudeMd`.
- Subagent spend counts toward `maxBudgetUsd`. `usage` excludes subagents and `modelUsage` includes them (`subagents.md`, `agent-loop.md`).

## 12. Streaming input and runtime control

Pass an `AsyncIterable<SDKUserMessage>` as `prompt` to keep one session open across many user messages (`streaming-vs-single-mode.md`). The `Query` object then lets you:
- **Steer the session:** `interrupt()`, `setPermissionMode()`, `setModel()`, `streamInput()`.
- **Inspect it:** `getContextUsage()`, `supportedModels()`, `mcpServerStatus()`.
- **Undo file edits:** `rewindFiles()`, which needs file checkpointing.

> **Gotcha.** `interrupt()` rejects with `Query closed before response received` if the query already finished. Inside a timer callback that becomes an unhandled rejection and crashes the process. The upstream interrupt example has this race (see the fact-check).

`startup()` and `prewarm()` pre-spawn the CLI to cut first-message latency. A spare process from `prewarm()` is later bound with `claim({ prompt, options: { cwd } })`, and the claim is refused if the folder can't be used.

## 13. Context, compaction, cost

- **Compaction is automatic.** You steer it with CLAUDE.md instructions or the `PreCompact` hook, but there is no option to replace the algorithm (`agent-loop.md`).
- **Track spend** with `total_cost_usd` and `modelUsage` on the result. `getContextUsage()` breaks down context by category (`cost-tracking.md`).
- **Cap spend** with `maxBudgetUsd`. It stops after the response that crosses the cap, so leave headroom.

## 14. Production checklist

- **Isolation:** run each agent in a container or sandbox with an egress proxy. Keep credentials outside, for example `ANTHROPIC_BASE_URL` pointed at a key-injecting proxy (`secure-deployment.md`, `hosting.md`).
- **Multi-tenant:** use `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-tenant `CLAUDE_CONFIG_DIR` and a per-tenant `cwd` (`hosting.md`). Our test harness, even with its own `CLAUDE_CONFIG_DIR` and `settingSources: []`, still picked up this host's extra tools and agent types, most likely through inherited environment variables. Build the subprocess `env` explicitly and audit the `init` message's `tools` list in production.
- **Durability:** use a `sessionStore` for any session a user may resume.
- **Limits:** there's no top-level session timeout or per-subagent deadline. Always set `maxTurns` and `maxBudgetUsd`.
- **Observability:** set `CLAUDE_CODE_ENABLE_TELEMETRY=1` plus the standard `OTEL_*` variables. Traces also need `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`. Prompts and tool inputs are excluded unless you opt in (`observability.md`, `hosting.md`).
- **Errors:** a nonexistent `cwd` surfaces as "native binary … exists but failed to launch … libc", which is misleading, so validate `cwd` yourself first. **[verified]**

## 15. Build an agent, step by step

The capstone [`07-triage-agent.ts`](../../../verify/claude-agent-sdk/examples/07-triage-agent.ts) builds a support-triage agent in about 80 lines, one layer at a time:

1. **Define the tools.** `lookup_customer` is read-only and `escalate` is risky. Both live in one `createSdkMcpServer`.
2. **Lock the surface.** `tools: []` removes every built-in tool, so the agent can only call your tools. `settingSources: []` ignores local settings.
3. **Approve by risk.** `allowedTools` auto-approves only the read-only tool. Everything else reaches `canUseTool`, which acts as the human-approval step and denies escalation.
4. **Audit.** A `PreToolUse` hook records every call and returns `{}`, so it makes no decision.
5. **Contract the output.** `outputFormat` with a draft-7 schema, read back from `result.structured_output`.
6. **Bound it.** Set `maxTurns` and `maxBudgetUsd`, then branch on `result.subtype`.

Run it, along with the other examples, offline:

```bash
cd verify/claude-agent-sdk && npm install && npm test
```

## Verified examples index

| File | Demonstrates |
|---|---|
| `01-hello-agent.ts` | Minimal `query()`, init message, success result fields |
| `02-custom-tool.ts` | `tool()` + `createSdkMcpServer`, `mcp__` naming, Zod validation, tool_result turn |
| `03-permission-order.ts` | All six permission steps, including the shadowing warning, deny-over-bypass and `dontAsk` |
| `04-max-turns.ts` | `error_max_turns`, error-result fields, throw-after-result |
| `05-structured-output.ts` | `outputFormat` with draft-7 Zod schema, `StructuredOutput` tool |
| `06-resume-session.ts` | `session_id` capture, `resume` keeps id and history |
| `07-triage-agent.ts` | Capstone combining all of the above |
