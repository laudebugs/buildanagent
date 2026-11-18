# Five ways to build the same agent: whoever owns the loop owns the safety defaults

*As of November 2026, comparing `@anthropic-ai/claude-agent-sdk@0.3.327`, `@earendil-works/pi-coding-agent@1.5.2`, `@openai/agents@0.21.0`, `ai@7.0.162` and `langchain@1.6.1` in TypeScript. LangChain.js joined on 2026-11-18, after the first four. Every claim traces to one of the five references in [`docs/reference/`](../reference/) or to the [feature table](feature-table.md); claims about our own capstones come from the runnable files in `verify/<sdk>/examples/`.*

We built one support-triage agent five times, once on each SDK, and ran all five offline under test. Each agent looks up a customer, refuses or pauses a risky action, and returns a typed triage record. The five programs come out within 30 lines of each other, so code size doesn't separate the SDKs. What separates them is who decides when a risky tool may run, where the paused state lives, and which defaults send data or credentials out of your process. In this comparison, I read the five capstones side by side, set out the design trade-offs behind them, and draw the lessons for the SDK, harness and agent we plan to build. The main lesson is the surprising one: four of the five SDKs have at least one default that reaches outside your process, so our own stack should make every such reach an explicit setting, as LangChain does with tracing.

## 1. The same agent takes 58 to 87 lines on every SDK, and differs in its gate

The five capstones implement the same contract: a read-only lookup tool, a state-changing tool that a person must approve, a typed result, and an offline test. The table counts non-blank, non-comment lines, which include each file's scripted model and its assertions:

| | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| File | [`07-triage-agent.ts`](../../verify/claude-agent-sdk/examples/07-triage-agent.ts) | [`08-triage-agent.ts`](../../verify/pi/examples/08-triage-agent.ts) | [`09-triage-agent.ts`](../../verify/openai-agents-sdk/examples/09-triage-agent.ts) | [`09-triage-agent.ts`](../../verify/vercel-ai-sdk/examples/09-triage-agent.ts) | [`10-triage-agent.ts`](../../verify/langchain/examples/10-triage-agent.ts) |
| Code lines | 65 | 87 | 76 | 58 | 67 |
| Tool surface | `tools: []` removes the CLI's built-ins; two tools in one SDK MCP server | `noTools: "builtin"`; three `defineTool()` tools | Two `tool()` tools; no built-ins to remove | Two `tool()` tools; no built-ins to remove | Two `tool()` tools; no built-ins to remove |
| Risky tool | `allowedTools` approves only the lookup; `canUseTool` denies `escalate` | A `tool_call` extension blocks `escalate` | `needsApproval` pauses; a person rejects through a serialised `RunState` | `toolApproval: 'user-approval'` pauses; a person approves through the next call's messages | `humanInTheLoopMiddleware` interrupts; a person rejects through `Command({ resume })` on the same thread |
| Typed result | `outputFormat` with a draft-07 schema | A `submit_triage` tool that returns `terminate: true` | Zod `outputType` | `Output.object` with a Zod schema | `responseFormat` with a titled Zod schema |
| Extra guard | A `PreToolUse` audit hook; `maxTurns`, `maxBudgetUsd` | An audit in the same extension | An input guardrail that blocks injection before any model call | An explicit `stopWhen: isStepCount(8)` | A `wrapToolCall` audit middleware; `recursionLimit: 12`; a checkpointer and `thread_id` |
| Test seam | A mock Messages API behind `ANTHROPIC_BASE_URL` | `fauxProvider()` | `ScriptedModel` | `MockLanguageModelV4` | `fakeModel()` |

Two rows hold the real differences. First, the **risky tool** row shows two kinds of gate. Claude and Pi decide inside the running loop: `canUseTool` and the `tool_call` extension return allow or deny while the run waits. OpenAI, Vercel and LangChain instead end the run and hand back the pending call, so a person can decide hours later, in another process. They differ in where the pause lives: a serialised `RunState`, the message array, or a LangGraph checkpoint keyed by `thread_id`. Second, the **test seam** row shows where each SDK lets you swap the model. Four SDKs take a model object in-process. Claude's loop runs in the CLI subprocess, so its only seam is the HTTP API, and our harness had to reimplement Anthropic's tool-search step before its tests passed (Claude guide §5).

The **typed result** row converges more than it looks. Claude's `outputFormat` is answered through a `StructuredOutput` tool call (Claude guide §9), and Pi's pattern is a terminating tool. LangChain picks per model: the provider's JSON mode when the model's profile supports it, else a tool named after the schema (LangChain guide §7). So at least two of the five get structured output from a final tool call, and the rest from the provider's JSON mode or a choice between them. A final tool is the portable choice, because every provider that calls tools supports it.

## 2. Four design trade-offs explain the differences

### Loop ownership decides how much you can replace

The SDKs sit on a line from configured to owned. Claude's CLI owns the loop, the tools, the transcripts and compaction, so you configure 70 options and 33 hook events but replace nothing (Claude guide §4, §8, §13). OpenAI's, Vercel's and LangChain's loops run in your process and take any model provider. Compaction and sessions come from fixed components, from middleware and LangGraph (LangChain), or from you. Pi exposes everything as in-process packages, including a loop core of about 950 lines that you can read end to end (Pi guide §1). The more of the loop you own, the more you can ablate as models improve, which the [research report](../research/agent-sdks-and-harness-design.md) names as the main reason to build.

### Safety defaults range from six permission steps to none

Claude ships the strongest default: six ordered permission steps in which deny rules win even in `bypassPermissions` (Claude guide §7). Pi ships no gate at all, so every tool call runs with the process's permissions until an extension blocks it (Pi guide §6). OpenAI, Vercel and LangChain sit between them, with per-tool, per-call or middleware approval and no permission modes. A strong default still needs care. Claude's `canUseTool` silently never runs for a tool you also list in `allowedTools`, and the SDK warns only through a Node warning (Claude guide §7). A gate is only as good as the rule that decides which calls reach it.

### State lives in five places

Each SDK keeps the conversation somewhere different. Claude writes JSONL transcripts to the CLI's local disk, so a container restart loses them unless a `sessionStore` mirrors them (Claude guide §10). Pi writes a tree of entries with parent ids, so branching and compaction never delete history (Pi guide §8, §9). OpenAI offers session objects, in memory, on OpenAI's servers or over your database (OpenAI guide §9). Vercel keeps no state; the `messages` array you pass back is the whole state, approvals included (Vercel guide §7). LangChain keeps state in a LangGraph checkpointer per `thread_id`, and a checkpointed agent refuses to run without one (LangChain guide §8). The tree is the most capable design, and the plain array is the easiest to persist.

### Four of five SDKs have a default that reaches outside your process

Four of the five references found one default that sends data or credentials somewhere the developer didn't choose:
- **Claude:** the CLI inherits the parent's environment, so host credentials and tools reach the agent unless you pass an allowlisted `env` (Claude fact-check F5).
- **Pi:** without an explicit model, a session can authenticate to Bedrock or Vertex from ambient cloud credentials, and our first unscrubbed run did exactly that (Pi guide §2).
- **OpenAI:** tracing is on in Node.js and exports every run's model calls and tool calls to OpenAI's dashboard (OpenAI guide §2).
- **Vercel:** model strings route through Vercel's AI Gateway, and an approval response is unsigned unless you set `experimental_toolApprovalSecret` (Vercel guide §2, §7).

LangChain is the exception: LangSmith tracing starts only when you set `LANGSMITH_TRACING=true` and a key (LangChain guide §2). Its nearest trap points inward. A bare model id that `initChatModel` can't map to a provider throws, which broke the docs' own first example (LangChain fact-check F1).

Each SDK documents its own default, so none of them is a bug. Together, though, they show a pattern: a convenient default for the first run becomes a leak in production. Our verification harnesses ended up with the same three defenses for all five SDKs: an allowlisted environment, a network guard and a mock model that refuses host tools by name.

## 3. Lessons for our SDK, harness and agent

Our planned stack has three layers, and each SDK teaches something about each one. The lists below say what to copy and what to avoid; Round G starts from them.

### The SDK layer: one model interface, composable stops and a first-party mock

Copy:
- **One model specification** that every provider implements, as Vercel's `LanguageModelV4` and pi-ai's provider interface do. Both let a test swap the model with one object (Vercel guide §1, Pi guide §12).
- **Composable stop conditions**, such as Vercel's `isStepCount`, `hasToolCall` and condition arrays, with an explicit cap on every loop (Vercel guide §5).
- **A first-party mock model in a `testing` export**, scripted by turns or computed from the request. `ScriptedModel`, `fauxProvider`, `MockLanguageModelV4` and LangChain's `fakeModel()` made four of the five SDKs testable with one import; Claude's lack of one cost us a mock API.
- **Typed errors for each way a run ends**, as OpenAI's `MaxTurnsExceededError` and Vercel's `NoObjectGeneratedError` do, rather than a status field you can forget to check.

Avoid:
- **Implicit routing.** Resolve a model only from an explicit provider, never from a hosted gateway or ambient cloud credentials by default.
- **Default export of traces.** Ship OpenTelemetry spans to a backend only when the caller names one.

### The harness layer: a tree log, an explicit gate pipeline and resumable approvals

Copy:
- **Pi's tree-shaped session log**, with compaction as an appended summary entry, so neither branching nor compaction loses history (Pi guide §8, §9).
- **Claude's ordered permission pipeline**, with deny rules that always win. Make the order a documented, observable part of the API instead of a rule users must memorise (Claude guide §7).
- **Resumable approvals.** Store a paused run as data, as OpenAI's `RunState` and Vercel's messages do, so a person can approve from another process. Sign each approval request, as Vercel's `experimental_toolApprovalSecret` does, so a client can't forge one (OpenAI guide §8, Vercel guide §7).
- **Middleware with a fixed hook set.** LangChain's six hooks (`beforeAgent`, `beforeModel`, `afterModel`, `afterAgent`, `wrapModelCall`, `wrapToolCall`) carry every built-in feature, from summarisation to approval, so each one can be removed or ablated on its own (LangChain guide §5).
- **Steering queues.** Pi's `steer()` and `followUp()`, and Vercel's `experimental_steering`, let a user redirect a running loop at step boundaries without a race (Pi guide §7).

Avoid:
- **A subprocess per session.** Claude's design costs about 1 GiB of RAM per agent and leaves HTTP as the only test seam (Claude guide §1).
- **Gates that silently skip.** A rule that makes a callback unreachable should fail loudly, not warn.
- **Inherited environments.** Spawn every tool process with an allowlisted environment, the rule our harnesses now follow.

### The agent layer: few tools, a gate per risk and a final tool for output

Copy:
- **A minimal tool surface.** Every capstone removed or never had built-in tools. Start from zero tools and add each one for a reason.
- **One gate per risk level.** Read-only tools run freely; each state-changing tool needs a person or a policy.
- **Typed output through a final tool**, which works on every provider (section 1).
- **An explicit step cap, plus a spend cap where the SDK has one.** The Claude capstone sets both, and the Vercel capstone sets the step cap.

Avoid:
- **Relying on SDK defaults for limits.** The defaults ranged from 1 step (`generateText`) to 20 (`ToolLoopAgent`), 10 turns (OpenAI) and no cap at all (Pi), so an agent should state its own.

## 4. The docs were accurate on API surfaces and weakest in examples

The five fact-checks found the reference tables trustworthy everywhere. Claude, OpenAI, Vercel and LangChain documented options that all exist, and Pi's reference pages matched its types exactly. The errors sat in examples: six Pi README blocks, two OpenAI errors (a handoff name and a wrong "required" mark), twelve Vercel blocks that lag the release, and a racy Claude interrupt example (feature table, Operations). LangChain's JavaScript examples were the least accurate: 78 of 713 blocks disagree with the 1.6.1 types, and five more use names from newer releases. Two process lessons follow for our own SDK's docs. First, publish docs from the release tag. Pi's site rendered its main branch ahead of the npm release, and LangChain's docs repo has no release tags at all, so its pages describe features that arrived after the release we pinned. Second, type-check and run every example in CI against the published package, as OpenAI's `build-check` script does for its embedded files.

## Conclusion: build the loop we can own, and make every outward reach a setting

The five SDKs converge on the same loop and differ on who controls it. Claude gives the most safety with the least control, Pi the most control with no safety, and OpenAI, Vercel and LangChain sit between them with approvals that survive a restart. LangChain adds the most ready-made middleware. For our own stack, the comparison points to one design. Build an in-process loop over a single model interface, as Vercel and Pi do. Keep a tree-shaped log, as Pi does, and run an ordered gate pipeline in which deny always wins, as Claude does. Approvals should be signed and resumable, as in OpenAI, Vercel and LangChain. Features beyond the loop should be removable middleware with a small, fixed set of hooks, as LangChain's six are. Above all, make every reach outside the process an explicit setting, as LangChain does with tracing: model routing, telemetry export and environment inheritance. Round G turns these lessons into research and build guides for the SDK, the harness and the agent.
