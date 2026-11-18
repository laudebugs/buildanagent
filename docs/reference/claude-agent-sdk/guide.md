# Building agents with the Claude Agent SDK: narrow what Claude Code's loop may do

*Version `@anthropic-ai/claude-agent-sdk@0.3.327`, TypeScript, November 2026. **[verified]** marks a claim asserted by a runnable example in [`verify/claude-agent-sdk/examples/`](../../../verify/claude-agent-sdk/examples/), run offline against the mock API (a local mock of the Anthropic Messages API). Other claims cite their upstream page as `source/<page>.md` (regenerate with `npm run fetch-docs`); [fact-check.md](fact-check.md) rates those pages.*

The Claude Agent SDK gives you Claude Code's production loop, tools, permissions and sessions in one `npm install`. Its main constraint follows from that design: the SDK runs the Claude Code CLI as a subprocess, and the CLI owns the loop. A team choosing the SDK needs to know which levers the CLI exposes, which defaults surprise people, and what a safe production setup looks like. In this guide, I show that because the CLI owns the loop, you build a production agent by narrowing what the CLI may do: fewer tools, approval by risk, and hard limits on every run.

## 1. The SDK runs Claude Code as a subprocess you configure

The Agent SDK is "Claude Code as a library". When you call `query()`, the SDK spawns the bundled Claude Code CLI (**the CLI**) as a subprocess and talks to it over stdio. The CLI owns the agent loop, the built-in tools, the shell, the working directory and the session transcripts (`hosting.md`). Your code configures the loop and reads its messages, while the CLI runs it.

Anthropic offers four ways to run an agent, and the Agent SDK fits one of them (`overview.md`):

| You want to | Use |
|---|---|
| Embed Claude Code's loop, tools, permissions, sessions and hooks in your app | **Agent SDK** |
| Call the Messages API and write the tool loop yourself | Client SDK (`@anthropic-ai/sdk`) |
| Let Anthropic host the loop and the sandbox | Managed Agents |
| Drive the same loop from another language | `claude -p --output-format json` as a subprocess |

Running the CLI as a subprocess has three consequences for a team:
- **Each session costs a CLI subprocess.** Budget about 1 GiB RAM, 5 GiB disk and 1 CPU per agent as a floor (`hosting.md`).
- **Only Claude models run it.** They come from the Anthropic API, from Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`) or from Google Cloud (`quickstart.md`).
- **Commercial terms govern use.** The package carries an MIT label, but Anthropic's Commercial Terms govern how you use it. Third-party products need approval to offer claude.ai login. They may say "Powered by Claude" but may not call themselves "Claude Code" (`overview.md`, `quickstart.md`).

## 2. Install the package and authenticate with an API key

```bash
npm install @anthropic-ai/claude-agent-sdk zod
export ANTHROPIC_API_KEY=...   # needs Node.js 18.14+; the SDK ignores .env files
```

Installation comes down to three points. First, keep optional dependencies on, because the CLI binary arrives as one, such as `@anthropic-ai/claude-agent-sdk-linux-x64`. Second, the SDK pins the CLI to its own version, so updating the SDK updates the CLI. Anthropic advises taking patch releases freely and reading the changelog before a minor release (`hosting.md`). Third, `ANTHROPIC_BASE_URL` routes model calls through a gateway or proxy. The verification harness uses that same variable to substitute the mock API. **[verified]**

## 3. The loop streams messages and always ends with a result

A minimal agent iterates over `query()` and waits for the result:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({ prompt: "What files are here?", options: { maxTurns: 5 } })) {
  if (message.type === "result" && message.subtype === "success") console.log(message.result);
}
```

`query()` returns a `Query`, an `AsyncGenerator<SDKMessage>` with extra control methods. Every run follows the same sequence (`agent-loop.md`):
1. A `system` message with `subtype: "init"` arrives first, carrying the session id, tools and model. **[verified: 01]**
2. `assistant` messages carry text and `tool_use` blocks, and `user` messages carry the `tool_result`s. The loop repeats this cycle without returning control to your code. **[verified: 02]**
3. A `result` message ends the run.

A **turn** is one model call plus the tool calls it triggers. Because the final text-only answer also counts as a turn, `maxTurns` must leave room for it; otherwise the run ends in `error_max_turns` (`agent-loop.md`). **[verified: 04]**

### Read the result subtype before the result text

The `subtype` field tells you how the run ended, and only a successful run carries `result` text:

| `subtype` | Meaning | `result` text? |
|---|---|---|
| `success` | Finished normally | yes **[verified: 01]** |
| `error_max_turns` | Hit `maxTurns` | no **[verified: 04]** |
| `error_max_budget_usd` | Hit `maxBudgetUsd` | no |
| `error_during_execution` | Interrupted or crashed | no |
| `error_max_structured_output_retries` | Produced no schema-valid output | no |

Every variant still carries `session_id`, `total_cost_usd`, `usage`, `num_turns` and `stop_reason`, so you can resume and bill after a failure. **[verified: 01, 04]** For cost, `usage` counts only the main loop; `modelUsage` covers the whole tree, subagents included.

> **Gotcha.** After an error result, a single-shot `query()` **throws**, for example `Reached maximum number of turns`, *after* it yields the result message. Wrap the loop in `try`. **[verified: 04]**

Beyond these core types, `SDKMessage` is a 40-member union. The union also includes streaming deltas (`stream_event`, with `includePartialMessages`), compaction boundaries, hook progress, subagent lifecycle, rate-limit events, API retries and refusal fallbacks. Switch on `type` first, then on `subtype`.

## 4. About 30 of the 70 options cover everyday agents

`Options` has 70 top-level fields, listed in `typescript.md#options` and `sdk.d.ts`. Most agents need only these, grouped by concern:

| Concern | Options |
|---|---|
| Loop limits | `maxTurns`, `maxBudgetUsd`, `effort` (`low` … `max`), `maxThinkingTokens`, `abortController` |
| Model | `model`, `fallbackModel`, `betas` |
| Prompting | `systemPrompt` (string, string[], `{ type: "custom", prompt }`, or `{ type: "preset", preset: "claude_code", … }`), `settingSources` |
| Tools | `tools`, `allowedTools`, `disallowedTools`, `mcpServers` |
| Permissions | `permissionMode`, `allowDangerouslySkipPermissions`, `canUseTool`, `permissionPrompts` |
| Extension | `hooks`, `agents`, `plugins`, `outputFormat` |
| Sessions | `resume`, `continue`, `forkSession`, `sessionStore`, `persistSession` |
| Environment | `cwd`, `additionalDirectories`, `env`, `executable`, `pathToClaudeCodeExecutable` |
| Streaming | `includePartialMessages` |

The three tool options sound alike but do different jobs:
- **`tools`** decides which built-in tools *exist*. `tools: []` removes Bash, Edit, Read and the rest. **[verified: 07]**
- **`allowedTools`** *auto-approves*. Unlisted tools stay available and fall through to the permission flow.
- **`disallowedTools`** *removes and denies*, even in `bypassPermissions` mode. **[verified: 03c]**

## 5. Custom tools are in-process MCP servers

You define a tool with `tool()` and register it by wrapping it in `createSdkMcpServer()`:

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

The handler receives arguments that Zod has already validated, and the model sees the tool as `mcp__<server>__<tool>`. **[verified: 02]** Handlers shape what the model reads in four ways (`custom-tools.md`):
- `isError: true` sets the error text the model sees.
- `structuredContent` returns machine-readable JSON.
- `image` and `resource` blocks return files.
- `readOnlyHint` lets read-only calls run in parallel.

For approval, a server config with `permission_policy: "always_ask"` forces a prompt even over `allowedTools` (`custom-tools.md`, `permissions.md`).

**Tool search defers MCP tools by default**, including behind an `ANTHROPIC_BASE_URL` gateway. The model first sees only the tool names, and it must call `ToolSearch` with `select:<name>` to load a schema before it can call the tool. The mock API had to implement this step before examples 02–04 would pass. **[verified]** The `ENABLE_TOOL_SEARCH` variable in `env` (`true`, `false`, `auto` or `auto:N`) controls deferral (`tool-search.md`). With `tools: []` in example 07, the CLI offered MCP tools upfront instead.

## 6. External MCP servers plug in through four config types

`mcpServers` accepts four kinds of config (`typescript.md#mcpserverconfig`, `mcp.md`):
- stdio: `{ command, args, env }`
- `{ type: "sse", url, headers }`
- `{ type: "http", url, headers }`
- SDK servers returned by `createSdkMcpServer`

At runtime, four `Query` methods manage those servers: `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()` and `setMcpServers()`.

## 7. Six permission steps run in a fixed order, and deny rules always win

Claude Code checks every tool call against six steps, in this order (`permissions.md`):
1. **Hooks.** A `PreToolUse` hook can deny the call. Its `allow`, however, leaves steps 2 and 3 in force. **[verified: 03d, 03e]**
2. **Deny rules** come from `disallowedTools` and settings. A match ends the check, even in `bypassPermissions`, and `canUseTool` never runs. **[verified: 03c]**
3. **Ask rules** come from settings `ask` entries, `always_ask` tools and `AskUserQuestion`. They send the call to `canUseTool`, even in `bypassPermissions`.
4. **The permission mode** applies next: `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions` or `auto`. `sdk.d.ts` lists the same six.
5. **Allow rules** come from `allowedTools` and settings. A match approves the call, so `canUseTool` never sees it. **[verified: 03b]**
6. **`canUseTool`** decides whatever is left. **[verified: 03a]** In `dontAsk` mode, this step denies instead. **[verified: 03f]**

A `canUseTool` callback returns allow or deny for one call:

```ts
canUseTool: async (toolName, input, { signal, suggestions }) =>
  toolName === "mcp__ops__restart_service"
    ? { behavior: "deny", message: "Needs a human" }
    : { behavior: "allow", updatedInput: input },
```

> **Gotcha.** If you pass `canUseTool` together with a bare tool name in `allowedTools`, or together with `bypassPermissions`, the SDK emits the Node warning `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`. The warning means your callback will never run for those calls. To gate *every* call, use a `PreToolUse` hook instead. **[verified: 03b]**

## 8. Hooks intercept 33 lifecycle events

The `hooks` option has the type `Partial<Record<HookEvent, HookCallbackMatcher[]>>`, and the docs and the package agree on all 33 events. Most agents use these:
- `PreToolUse`, `PostToolUse` and `PostToolUseFailure`
- `PermissionRequest` and `PermissionDenied`
- `UserPromptSubmit`, `Stop` and `Notification`
- `SessionStart` and `SessionEnd`
- `SubagentStart` and `SubagentStop`
- `PreCompact` and `PostCompact`

A matcher entry pairs a filter with one or more callbacks:

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

Besides a decision, a `PreToolUse` hook can return `updatedInput` to rewrite the arguments, or `additionalContext` and `systemMessage` to inform the model (`hooks.md`). An empty object, `{}`, leaves the decision to the next permission step. **[verified: 07]**

## 9. Structured output needs a draft-07 JSON Schema

Pass a JSON Schema in `outputFormat`, and the validated object arrives on the result:

```ts
const Ticket = z.object({ title: z.string(), priority: z.enum(["low", "medium", "high"]) });
const q = query({ prompt, options: {
  outputFormat: { type: "json_schema", schema: z.toJSONSchema(Ticket, { target: "draft-7" }) },
} });
// result.structured_output holds the validated object when subtype is "success"
```

The model answers through a `StructuredOutput` tool call, and the SDK copies the value to `result.structured_output`. **[verified: 05, 07]**

> **Gotcha.** Zod 4 targets draft 2020-12 unless you pass `{ target: "draft-7" }`, and the CLI rejects that schema and **exits with code 1** (`--json-schema is not a valid JSON Schema`). The docs warn about this in `structured-outputs.md`. **[verified]**

## 10. Sessions resume by ID but live on local disk by default

Every result carries a `session_id`, and passing it back as `resume` continues the same conversation with its full history and the same id. **[verified: 06]** Three related options change how a run starts (`sessions.md`):
- `forkSession: true` branches into a new session.
- `continue: true` resumes the most recent session in `cwd`.
- `resumeSessionAt` rewinds to a chosen message.

By default, the CLI writes JSONL transcripts under `~/.claude/projects/`, or under `CLAUDE_CONFIG_DIR` when you set it. A container restart therefore loses them. A `sessionStore` mirrors transcripts to your own storage on a best-effort basis, so alert on `mirror_error` messages. Memory files and working-directory artifacts need their own storage (`hosting.md`, `session-storage.md`).

The reference documents six management functions: `listSessions`, `getSessionMessages`, `getSessionInfo`, `renameSession`, `tagSession` and `forkSession`. The package also exports `archiveSession`, `unarchiveSession` and `deleteSession`, which the reference omits (see the fact-check).

## 11. Claude delegates to subagents you define by name

You define each subagent by name in `agents`, and Claude delegates to it through the `Agent` tool:

```ts
agents: {
  reviewer: {
    description: "Reviews diffs for security issues",   // tells Claude when to delegate
    prompt: "You are a security reviewer...",
    tools: ["Read", "Grep"], model: "sonnet", maxTurns: 10,
  },
},
```

`AgentDefinition` accepts more fields than this example shows:
- `disallowedTools`, which also takes `mcp__server__*` patterns
- `mcpServers`, `skills` and `background`
- `effort`, `permissionMode`, `memory` and `omitClaudeMd`

On cost, subagent spend counts toward `maxBudgetUsd`. The result's `usage` field excludes subagents, while `modelUsage` includes them (`subagents.md`, `agent-loop.md`).

## 12. Streaming input keeps one session open for many messages

To keep one session open across many user messages, pass an `AsyncIterable<SDKUserMessage>` as `prompt` (`streaming-vs-single-mode.md`). The `Query` object then exposes three groups of methods:
- **Steering:** `interrupt()`, `setPermissionMode()`, `setModel()` and `streamInput()`.
- **Inspection:** `getContextUsage()`, `supportedModels()` and `mcpServerStatus()`.
- **Undo:** `rewindFiles()`, which needs file checkpointing.

> **Gotcha.** If the query has already finished, `interrupt()` rejects with `Query closed before response received`. Inside a timer callback, that rejection goes unhandled and crashes the process. The upstream interrupt example has this race (see the fact-check).

To cut first-message latency, `startup()` and `prewarm()` spawn the CLI early. You later bind a prewarmed CLI with `claim({ prompt, options: { cwd } })`, and the CLI refuses the claim when it can't use the folder.

## 13. The CLI compacts context on its own and enforces budgets after each response

The CLI compacts context on its own. You can steer compaction with CLAUDE.md instructions or a `PreCompact` hook, but no option replaces the algorithm (`agent-loop.md`). For spend, the result's `total_cost_usd` and `modelUsage` report cost, and `getContextUsage()` breaks context down by category (`cost-tracking.md`). The `maxBudgetUsd` cap acts only after the response that crosses it, so a run can overshoot by one response. Set the cap with that headroom in mind.

## 14. Production agents need isolation, durable sessions and explicit limits

Six practices cover most production risk:
- **Isolation.** Run each agent in a container or sandbox behind an egress proxy. Keep credentials outside it, for example by pointing `ANTHROPIC_BASE_URL` at a proxy that injects the key (`secure-deployment.md`, `hosting.md`).
- **Multi-tenancy.** Set `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-tenant `CLAUDE_CONFIG_DIR` and a per-tenant `cwd` (`hosting.md`). Our harness still picked up this host's extra tools and agent types under all four settings, most likely through inherited environment variables. Build the CLI's `env` explicitly, and audit the `init` message's `tools` list.
- **Durability.** Configure a `sessionStore` for every session a user may resume.
- **Limits.** The SDK enforces no session timeout and no per-subagent deadline, so always set `maxTurns` and `maxBudgetUsd`.
- **Observability.** Set `CLAUDE_CODE_ENABLE_TELEMETRY=1` and the standard `OTEL_*` variables; traces also need `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`. Exports leave out prompts and tool inputs unless you opt in (`observability.md`, `hosting.md`).
- **Error handling.** A missing `cwd` surfaces as "native binary … exists but failed to launch … libc", which points at the wrong cause. Check that `cwd` exists before you call `query()`. **[verified]**

## 15. A locked-down triage agent takes six layers and about 80 lines

The capstone [`07-triage-agent.ts`](../../../verify/claude-agent-sdk/examples/07-triage-agent.ts) builds a support-triage agent one layer at a time:
1. **Define the tools.** `lookup_customer` reads data and `escalate` changes state. Both live in one `createSdkMcpServer`.
2. **Lock the surface.** `tools: []` removes every built-in tool, which leaves the agent with only your tools. `settingSources: []` ignores local settings.
3. **Approve by risk.** `allowedTools` auto-approves only the read-only tool. Every other call reaches `canUseTool`, which plays the human approver and denies escalation.
4. **Audit.** A `PreToolUse` hook records every call and returns `{}`, which leaves the decision to the permission flow.
5. **Fix the output shape.** `outputFormat` takes a draft-07 schema, and the code reads the answer from `result.structured_output`.
6. **Bound the run.** Set `maxTurns` and `maxBudgetUsd`, then branch on `result.subtype`.

```bash
cd verify/claude-agent-sdk && npm install && npm test
```

## 16. Seven runnable examples back every [verified] claim

| File | Demonstrates |
|---|---|
| `01-hello-agent.ts` | Minimal `query()`, the init message, success result fields |
| `02-custom-tool.ts` | `tool()` and `createSdkMcpServer`, `mcp__` naming, Zod validation, the tool_result turn |
| `03-permission-order.ts` | All six permission steps, including the shadowing warning, deny-over-bypass and `dontAsk` |
| `04-max-turns.ts` | `error_max_turns`, error-result fields, the throw after the result |
| `05-structured-output.ts` | `outputFormat` with a draft-07 Zod schema, the `StructuredOutput` tool |
| `06-resume-session.ts` | Capturing `session_id`; `resume` keeps the id and the history |
| `07-triage-agent.ts` | The capstone, combining all of the above |

## Conclusion: configure the loop, then lock it down

The Claude Agent SDK suits teams that want Claude Code's tuned loop and toolset without writing their own, and who can accept Claude-only models and one process per session. You control it through options, hooks and the six-step permission flow. A production agent therefore comes from narrowing that surface. Remove the built-in tools you don't need, auto-approve only read-only tools, and route every risky call through `canUseTool` or a `PreToolUse` hook. Then bound each run with `maxTurns` and `maxBudgetUsd`, and persist sessions with a `sessionStore`. To start, copy [`07-triage-agent.ts`](../../../verify/claude-agent-sdk/examples/07-triage-agent.ts), replace its tools with yours, and run `npm test` to confirm the permission flow still behaves as asserted.
