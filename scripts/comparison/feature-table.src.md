# Agent SDK feature table: five loops that differ most on safety defaults and state

*As of November 2026, for `@anthropic-ai/claude-agent-sdk@0.3.327`, `@earendil-works/pi-coding-agent@1.5.2`, `@openai/agents@0.21.0`, `ai@7.0.162` and `langchain@1.6.1`, all in TypeScript. Each cell links to the guide section or fact-check behind it. **(V)** means a runnable example in `verify/<sdk>/examples/` asserts the claim offline; **(D)** means the claim rests on the SDK's docs or package source; **—** means none of our sources covers it.*

The five SDKs share one core idea: a model calls tools in a loop until a stop condition holds. They differ in who runs that loop and how much they decide for you. Claude's SDK runs Claude Code's CLI as a subprocess and ships its full toolset and permission system. Pi runs a full coding harness in your process and leaves every safety gate to you. The OpenAI Agents SDK runs an in-process loop with guardrails, handoffs and resumable approvals. The Vercel AI SDK keeps only the loop and an approval policy, and leaves state to you. LangChain.js puts its loop on a LangGraph graph and adds features as middleware, with threads and interrupts from the graph runtime. Read the table by group: **Safety** and **State** separate the five most sharply, while **Tools** and **Output** show how much they now share.

## Architecture: one subprocess loop and four in-process loops

| Feature | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| Where the loop runs | A Claude Code CLI subprocess that owns the loop, tools and transcripts (D) {C§1} | In your process, across three packages: model API, loop core, coding agent (D) {P§1} | In your process; `run()` or a `Runner` drives it (D) {O§1} | In your process, inside `generateText`, `streamText` or `ToolLoopAgent` (D) {V§1} | In your process; `createAgent` compiles a two-node LangGraph graph (`model_request`, `tools`) (V) {L§1} |
| Other languages | Other languages drive the CLI through `claude -p --output-format json` (D) {C§1} | Other languages drive the `pi` CLI in JSON or RPC mode (D) {P§11} | A separate Python SDK; this reference covers JS only (D) {O§12} | — | LangChain Python, documented on the same pages (D) {Lfc} |
| License | MIT label, with Anthropic's Commercial Terms governing use (D) {C§1} | MIT (D) {P§1} | MIT (D) {O§2} | Apache-2.0 (D) {V§2} | MIT (D) {L§2} |
| Models | Claude only: Anthropic API, Bedrock or Google Cloud (D) {C§1} | Any of the 35 providers in `pi-ai` (D) {P§1} | Any `ModelProvider`; hosted tools and server sessions need OpenAI's Responses API (D) {O§14} | Any provider package; model strings default to Vercel's AI Gateway (D) {V§2} | Any provider package or `provider:model` string; bare ids must match known prefixes (V) {L§2} |
| Footprint | A bundled CLI binary; budget about 1 GiB RAM, 5 GiB disk and 1 CPU per session (D) {C§1} | Node.js 22.19+, no install scripts (D) {P§2} | `agents-core`, `agents-openai` and `agents-realtime` (D) {O§1} | `ai` plus one package per provider (D) {V§1} | `langchain`, `@langchain/core`, `@langchain/langgraph` plus one package per provider (D) {L§1} |

## Loop control: caps and stop conditions take four shapes

| Feature | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| Turn and spend caps | `maxTurns` ends in `error_max_turns` (V); `maxBudgetUsd` acts after the response that crosses it (D) {C§3} {C§13} | No turn-cap option in the 1.5.2 packages; `abort()` stops a run (D) {P§7} | `maxTurns` defaults to 10 and throws `MaxTurnsExceededError` (V) {O§3} | `stopWhen`: 1 step by default in `generateText`, 20 in `ToolLoopAgent`; no spend cap (V) {V§4} {V§5} | Recursion limit of 25 graph steps (13 model calls) throws `GraphRecursionError` (V); call-limit middleware (D) {L§9} |
| How a run ends | A `result` message whose `subtype` names the outcome; a single-shot `query()` throws after an error result (V) {C§3} | `agent_end`, then `agent_settled` once queued work is done; a tool result with `terminate: true` ends the run (V) {P§3} {P§10} | `finalOutput` when the response has output-type text and no tool calls, or a typed error (V) {O§3} | A stop condition holds, or a step ends without tool calls; `isStepCount`, `hasToolCall`, `isLoopFinished` (V) {V§5} | A response without tool calls, a structured-output tool call, or the recursion limit (V) {L§1} {L§7} |
| Streaming | A 40-member `SDKMessage` union, with deltas under `includePartialMessages` (D) {C§3} | `agent_*`, `turn_*`, `message_*` and `tool_execution_*` events (V) {P§3} | Raw model events plus ten run-item event names (D) {O§11} | `textStream` and typed parts such as `text-delta` (V) {V§9} | `streamMode` `"updates"` and `"values"` (V); `"messages"` and `"custom"` (D) {L§10} |
| Interrupt and steer | Streaming input: `interrupt()`, `streamInput()`, `setModel()`, `setPermissionMode()` (D) {C§12} | `steer()` and `followUp()` queue in order; `prompt()` mid-run rejects (V) {P§7} | `signal` aborts a run (D) {O§4} | `abortSignal` aborts a call; `experimental_steering` adds `steer()` (next step boundary) and `queue()` (after the current task) (D) [reference](../reference/vercel-ai-sdk/source/content/docs/07-reference/01-ai-sdk-core/01-generate-text.mdx) | Graph interrupts resumed with `Command` (V); the docs' "steering" means human approval (D) {L§6} |

## Tools: every SDK takes typed custom tools and MCP

| Feature | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| Built-in tools | Claude Code's toolset (Bash, Edit, Read, …); `tools: []` removes it (V) {C§4} | `read`, `bash`, `edit`, `write` by default; `grep`, `find`, `ls` on request (V) {P§5} | None that touch your machine; hosted tools run on OpenAI (D) {O§5} | None; provider-defined tools such as web search (D) {V§4} | None in `langchain`; Deep Agents adds filesystem tools (D) {L§11} |
| Custom tools | `tool()` with Zod inside `createSdkMcpServer`; named `mcp__<server>__<tool>` (V) {C§5} | `defineTool()` with TypeBox (V) {P§5} | `tool()` with Zod or JSON Schema (V) {O§5} | `tool()` with Zod or JSON Schema; invalid input becomes a `tool-error` (V) {V§4} | `tool()` with Zod; the second argument is the runtime (V) {L§4} |
| Parallel tool calls | `readOnlyHint` lets read-only calls run in parallel (D) {C§5} | — | — | `toolCallConcurrency` setting (D) [reference](../reference/vercel-ai-sdk/source/content/docs/07-reference/01-ai-sdk-core/01-generate-text.mdx) | — |
| Tool search and deferral | On by default for MCP tools; the model loads schemas through `ToolSearch` (V) {C§5} | A `tool_search` extension, which SDK sessions must add (D) {P§5} | A hosted tool on the Responses API (D) {O§5} | A `deferLoading` tool option (D) [reference](../reference/vercel-ai-sdk/source/content/docs/07-reference/01-ai-sdk-core/20-tool.mdx) | `providerToolSearchMiddleware` (D) [built-in page](../reference/langchain/source/src/oss/langchain/middleware/built-in.mdx) |
| MCP | Client for stdio, SSE and HTTP servers (D); custom tools are in-process MCP servers (V) {C§5} {C§6} | `createMcpExtension()`, off by default in SDK sessions (D) {P§5} | Hosted MCP, Streamable HTTP and stdio (D) {O§5} | `@ai-sdk/mcp` client over HTTP, SSE, stdio or a custom transport (V) {V§10} | `@langchain/mcp-adapters`, a separate package (D) {L§11} |

## Safety: from six permission steps to none

| Feature | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| Permission model | Six ordered steps and six modes; deny rules win even in `bypassPermissions` (V) {C§7} | None; tools run with the process's permissions (D) {P§6} | No permission modes; per-tool approval and guardrails (V) {O§7} {O§8} | A per-call `toolApproval` policy (V) {V§7} | None; middleware gates tool calls (V) {L§5} |
| Human approval | `canUseTool` callback (V) {C§7} | A `tool_call` extension that returns `{ block: true }` (V) {P§6} | `needsApproval` pauses the run; serialised `RunState` resumes it after `approve()` or `reject()` (V) {O§8} | `'user-approval'` returns a `tool-approval-request`; the next call carries the response (V) {V§7} | `humanInTheLoopMiddleware` interrupts; `Command({ resume: { decisions } })` approves or rejects (V) {L§6} |
| Blocking hooks | 33 hook events; a `PreToolUse` hook can deny (V) {C§8} | 41 extension events; `tool_call` can block (V) {P§6} | Input, output and tool guardrails throw tripwire errors (V) {O§7} | No blocking hook besides `toolApproval`; `prepareStep` reshapes each step (V) {V§6} | Six middleware hooks; `wrapToolCall` can answer for a tool (V) {L§5} |
| Sandbox | None built in; run the agent in a container behind an egress proxy (D) {C§14} | None built in; a container is "usually the strongest practical option" (D) {P§13} | `SandboxAgent` with local, Docker or hosted clients (D) {O§12} | An `experimental_sandbox` interface for sandbox-run tools (D) {V§4} | None in the core; Deep Agents' harness (D) {L§11} |
| Secrets and data that leave the process | The CLI inherits the parent's environment unless you pass an allowlisted `env` (V) {C§14} | Ambient cloud credentials can choose the model (V) {P§2} | Tracing exports every run to OpenAI unless disabled (D) {O§2} | Model strings send requests through the AI Gateway; approvals can be forged without `experimental_toolApprovalSecret` (D) {V§2} {V§7} | LangSmith tracing is opt-in (D); a bare model id must be inferable, or the call throws (V) {L§2} |

## State: from a session tree to bring-your-own messages

| Feature | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| Session storage | JSONL under `~/.claude/projects/`; a `sessionStore` mirrors it (D) {C§10} | JSONL tree files by default, or in memory (V) {P§8} | `MemorySession`, OpenAI's Conversations API, or a custom `Session` (V) {O§9} | None; you keep `messages` (D) {V§11} | A checkpointer per `thread_id`: `MemorySaver`, Postgres or MongoDB (V) {L§8} |
| Resume, fork, branch | `resume` by id (V); `forkSession`, `continue`, `resumeSessionAt` (D) {C§10} | `branch()` keeps both paths in one file (V); `/fork`, `/clone` (D) {P§8} | `RunState` resumes a paused run (V); `previousResponseId` (D) {O§8} {O§9} | Pass the stored `messages` back (V) {V§7} | Resume a thread or an interrupt by `thread_id` (V); time travel (D) {L§6} {L§8} |
| Compaction | Automatic and CLI-owned; a `PreCompact` hook can steer it (D) {C§13} | Automatic at the window minus `reserveTokens`; appends a summary entry and keeps the originals (V) {P§9} | `OpenAIResponsesCompactionSession` on the Responses API (D) {O§9} | None in the core; `prepareStep` can trim messages (D) {V§6} | `summarizationMiddleware` (D) {L§5} |
| Memory | Memory files and auto memory (D) {C§14} | `AGENTS.md` context files (D) {P§4} | — | Provider memory tools, memory providers or a custom tool (D) {V§11} | A store reached as `runtime.store` (V) {L§8} |

## Output: structured output everywhere, delegation in three forms

| Feature | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| Structured output | `outputFormat` with a draft-07 JSON Schema, answered through a `StructuredOutput` tool (V) {C§9} | A final tool with `terminate: true` (V) {P§10} | Zod `outputType`; bad output throws `ModelBehaviorError` (V) {O§10} | `Output.object`; bad output rejects with `NoObjectGeneratedError` (V) {V§8} | `responseFormat` → `structuredResponse`, via the provider's JSON mode or a tool (V) {L§7} |
| Multi-agent | Named subagents, called through the `Agent` tool (D) {C§11} | — | Handoffs (V) and agents as tools (D) {O§5} {O§6} | Subagents as tools that call another agent (D) {V§11} | Subagents, handoffs, routers and skills (D) {L§11} |

## Operations: four offline test seams, and docs of uneven accuracy

| Feature | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| Tracing | OpenTelemetry through `CLAUDE_CODE_ENABLE_TELEMETRY` and `OTEL_*` (D) {C§14} | — | On by default, exported to OpenAI's dashboard (D) {O§2} | Registered integrations such as `@ai-sdk/otel`; opt out per call (D) {V§13} | LangSmith, opt-in with `LANGSMITH_TRACING=true` (D) {L§2} |
| Cost accounting | `total_cost_usd` and `modelUsage` on every result (V) {C§3} | — | — | Token `usage` on every result (V) {V§3} | — |
| Offline test seam | No first-party mock; mock the Messages API through `ANTHROPIC_BASE_URL` (V) {C§2} | `fauxProvider()` (V) {P§12} | `ScriptedModel` (V) {O§13} | `MockLanguageModelV4` (V) {V§12} | `fakeModel()` (V) {L§12} |
| Docs accuracy | 385 blocks type-checked, 69 of 87 complete examples ran, 5 findings (V) {Cfc} | 334 sources, 6 README blocks with errors, 6 findings (V) {Pfc} | 182 sources, no API errors, 5 findings (V) {Ofc} | 741 blocks, 12 API mismatches, 8 findings (V) {Vfc} | 713 blocks, 78 API mismatches plus 5 ahead of the release, 8 findings (V) {Lfc} |

## Choose by the safety work you want to own

The table points to one decision. Pick the Claude Agent SDK if you want Claude Code's tools and permission system ready-made and can accept Claude-only models and a subprocess per session. Pick Pi if you want to own and read the whole harness, including its session tree and compaction, and will write the gates yourself. Pick the OpenAI Agents SDK if you need guardrails, handoffs and approvals that survive a restart, and will decide where traces go. Pick the Vercel AI SDK if you want the thinnest loop across providers and will bring your own state. Pick LangChain.js if you want the most ready-made middleware and durable threads, and will compile its examples against your release. The [deep comparison](deep-comparison.md) builds the same triage agent on all five and draws the lessons for our own stack.
