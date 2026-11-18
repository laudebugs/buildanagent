# Eight ways to build the same agent: whoever owns the loop owns the safety defaults

*As of November 2026, comparing `@anthropic-ai/claude-agent-sdk@0.3.327`, `@earendil-works/pi-coding-agent@1.5.2`, `@openai/agents@0.21.0`, `ai@7.0.162`, `langchain@1.6.1`, `agents@0.33.0` (with `@cloudflare/think@0.23.0`), `@google/adk@2.5.0` and `@github/copilot-sdk@1.0.31` in TypeScript. LangChain.js joined after the first four, and Cloudflare Agents, Google ADK and the GitHub Copilot SDK joined on 2026-11-18. Every claim traces to one of the eight references in [`docs/reference/`](../reference/), to the [feature table](feature-table.md) or to the [TypeScript gap report](typescript-gaps.md); claims about our own capstones come from the runnable files in `verify/<sdk>/examples/`.*

We built one support-triage agent eight times, once on each SDK, and ran all eight offline under test. Each agent looks up a customer, refuses or pauses a risky action, and returns a typed triage record. The programs run from 58 to 115 lines. The three newest are the longest, because two of them test extra cases and Cloudflare's adds helper methods for its test, so code size doesn't separate the SDKs. What separates them is who decides when a risky tool may run, where the paused state lives, and which defaults send data or credentials out of your process. In this comparison, I read the eight capstones side by side, set out the design trade-offs behind them, and draw the lessons for the SDK, harness and agent we plan to build. The main lesson is the surprising one: six of the eight SDKs have at least one default that reaches outside your process, so our own stack should make every such reach an explicit setting, as LangChain does with tracing.

## 1. The same agent takes 58 to 115 lines on every SDK, and differs in its gate

The eight capstones implement the same contract: a read-only lookup tool, a state-changing tool that a person must approve, a typed result, and an offline test. The tables count non-blank, non-comment lines, which include each file's scripted model and its assertions. The first table covers the five SDKs of the first rounds:

| | Claude Agent SDK | Pi | OpenAI Agents SDK | Vercel AI SDK | LangChain.js |
|---|---|---|---|---|---|
| File | [`07-triage-agent.ts`](../../verify/claude-agent-sdk/examples/07-triage-agent.ts) | [`08-triage-agent.ts`](../../verify/pi/examples/08-triage-agent.ts) | [`09-triage-agent.ts`](../../verify/openai-agents-sdk/examples/09-triage-agent.ts) | [`09-triage-agent.ts`](../../verify/vercel-ai-sdk/examples/09-triage-agent.ts) | [`10-triage-agent.ts`](../../verify/langchain/examples/10-triage-agent.ts) |
| Code lines | 65 | 87 | 76 | 58 | 67 |
| Tool surface | `tools: []` removes the CLI's built-ins; two tools in one SDK MCP server | `noTools: "builtin"`; three `defineTool()` tools | Two `tool()` tools; no built-ins to remove | Two `tool()` tools; no built-ins to remove | Two `tool()` tools; no built-ins to remove |
| Risky tool | `allowedTools` approves only the lookup; `canUseTool` denies `escalate` | A `tool_call` extension blocks `escalate` | `needsApproval` pauses; a person rejects through a serialised `RunState` | `toolApproval: 'user-approval'` pauses; a person approves through the next call's messages | `humanInTheLoopMiddleware` interrupts; a person rejects through `Command({ resume })` on the same thread |
| Typed result | `outputFormat` with a draft-07 schema | A `submit_triage` tool that returns `terminate: true` | Zod `outputType` | `Output.object` with a Zod schema | `responseFormat` with a titled Zod schema |
| Extra guard | A `PreToolUse` audit hook; `maxTurns`, `maxBudgetUsd` | An audit in the same extension | An input guardrail that blocks injection before any model call | An explicit `stopWhen: isStepCount(8)` | A `wrapToolCall` audit middleware; `recursionLimit: 12`; a checkpointer and `thread_id` |
| Test seam | A mock Messages API behind `ANTHROPIC_BASE_URL` | `fauxProvider()` | `ScriptedModel` | `MockLanguageModelV4` | `fakeModel()` |

The second table covers the three SDKs added on 2026-11-18:

| | Cloudflare Agents | Google ADK | GitHub Copilot SDK |
|---|---|---|---|
| File | [`09-triage-agent.ts`](../../verify/cloudflare-agents/examples/09-triage-agent.ts) | [`08-triage-agent.ts`](../../verify/google-adk/examples/08-triage-agent.ts) | [`09-triage-agent.ts`](../../verify/copilot-sdk/examples/09-triage-agent.ts) |
| Code lines | 115 | 114 | 105 |
| Cases tested | One approved escalation | An approved escalation, a rejected one and a session with no customer | A rejected escalation, an approved one and a result that fails the schema |
| Tool surface | Two `tool()` tools from Think's `getTools()`; Think's seven workspace tools stay on the triage turn | Two `FunctionTool` tools; no host tools offered | `availableTools: new ToolSet().addCustom("*")` removes the runtime's 19 built-ins; two `defineTool()` tools |
| Risky tool | `needsApproval: true` pauses the turn in SQLite; a person approves with a `cf_agent_tool_approval` frame over a WebSocket | `requireConfirmation: true` pauses; a person approves or rejects with a `functionResponse` on the same session | `onPermissionRequest` returns `no-result`; a reviewer answers through `handlePendingPermissionRequest` |
| Typed result | `beforeTurn` returns `Output.object` with `activeTools: []`, gated on an instance field | `outputSchema` with `outputKey`, re-parsed with Zod because ADK only logs a violation | `sendAndWait(prompt, Triage)` parses with Zod and throws on a mismatch |
| Extra guard | None beyond the gate; the run logs the identity warning, because the class keeps `sendIdentityOnConnect` on | The lookup reads the customer from `user:customer_id` state; a `beforeToolCallback` refuses host tool names | The lookup reads the customer from trusted context; `skipPermission` on the lookup; every other request is rejected |
| Test seam | `MockLanguageModelV4` from `ai/test`, inside workerd through Miniflare | A `BaseLlm` subclass, `ScriptedLlm` | A mock Anthropic API behind a BYOK `provider`, in a network namespace |

Two rows hold the real differences. First, the **risky tool** row shows two kinds of gate. Claude, Pi and Copilot decide while the run waits. `canUseTool` and the `tool_call` extension return allow or deny, and Copilot's `no-result` holds the call open until the reviewer answers the live session (Copilot guide §5). OpenAI, Vercel, LangChain, Cloudflare and ADK instead end the turn and store the pending call, so a person can decide hours later, in another process or on another connection. They differ in where the pause lives: a serialised `RunState`, the message array, a LangGraph checkpoint keyed by `thread_id`, the agent's own SQLite, or ADK's session events (Cloudflare guide §9, ADK guide §9). Second, the **test seam** row shows where each SDK lets you swap the model. Six SDKs take a model object in-process; Cloudflare reuses the AI SDK's mock, and ADK needs a dozen-line subclass. Claude and Copilot run their loops in a separate runtime, so their only seam is the HTTP API. Our harnesses had to reimplement Anthropic's tool-search step for Claude, and inject the mock `provider` into every Copilot session through a preload (Claude guide §5, Copilot guide §11).

The **typed result** row converges more than it looks. Claude's `outputFormat` is answered through a `StructuredOutput` tool call (Claude guide §9), and Pi's pattern is a terminating tool. LangChain picks per model: the provider's JSON mode when the model's profile supports it, else a tool named after the schema (LangChain guide §7). ADK does the same when an agent has tools, because the Gemini API can't combine tools with a response schema, so it offers a `set_model_response` tool (ADK guide §8). So at least three of the eight get structured output from a final tool call, and the rest from the provider's JSON mode or a choice between them. A final tool is the portable choice, because every provider that calls tools supports it. Enforcement differs more than transport. OpenAI, Vercel and Copilot throw on bad output, while ADK logs the violation and stores the invalid value, so its capstone re-parses with Zod (feature table, Output; ADK guide §8).

## 2. Five design trade-offs explain the differences

### Loop ownership decides how much you can replace

The SDKs sit on a line from configured to owned. Claude's CLI owns the loop, the tools, the transcripts and compaction, so you configure 70 options and 33 hook events but replace nothing (Claude guide §4, §8, §13). Copilot's runtime sits at the same end: it owns the loop, the built-in tools and the session store, and you shape it only through session options, callbacks and RPC methods (Copilot guide §1). Cloudflare splits ownership. The platform owns each agent's lifecycle and storage, and the AI SDK owns the loop, which you call yourself in `AIChatAgent` or hand to Think (Cloudflare guide §1, §8). OpenAI's, Vercel's, LangChain's and ADK's loops run in your process. Compaction and sessions come from fixed components, from middleware and LangGraph (LangChain), from session services (ADK), or from you. Pi exposes everything as in-process packages, including a loop core of about 950 lines that you can read end to end (Pi guide §1). The more of the loop you own, the more you can ablate as models improve, which the [research report](../research/agent-sdks-and-harness-design.md) names as the main reason to build.

### Safety defaults range from six permission steps to none

Claude ships the strongest default: six ordered permission steps in which deny rules win even in `bypassPermissions` (Claude guide §7). Pi ships no gate at all, so every tool call runs with the process's permissions until an extension blocks it (Pi guide §6). Copilot's runtime starts wide and closes on a missing handler. A default session offers 19 built-ins, `bash` and `edit` among them, and the Quick Start approves every call with `approveAll`. Yet a session with no permission handler denies every call that asks, although the docs say it leaves them pending (Copilot guide §5, §6).

OpenAI, Vercel, LangChain, Cloudflare and ADK sit between these poles, with per-tool, per-call or middleware approval and no permission modes. Two of them surprise a reader who copies the docs. Think offers `write`, `edit` and `delete` on its workspace in every turn (Cloudflare guide §8), and ADK's confirmation page tells TypeScript users to build approval by hand although `requireConfirmation` exists (ADK guide §9). So even the middle ground needs a check of which tools the model sees and which gates the package really has.

A strong default still needs care, too. Claude's `canUseTool` silently never runs for a tool you also list in `allowedTools`, and the SDK warns only through a Node warning (Claude guide §7). A gate is only as good as the rule that decides which calls reach it.

### State lives in eight places

Each SDK keeps the conversation somewhere different:
- **Claude** writes JSONL transcripts to the CLI's local disk, so a container restart loses them unless a `sessionStore` mirrors them (Claude guide §10).
- **Copilot** writes sessions to the runtime's disk under `baseDirectory`, and a resume keeps the history but drops your custom tools (Copilot guide §3).
- **Pi** writes a tree of entries with parent ids, so branching and compaction never delete history (Pi guide §8, §9).
- **OpenAI** and **ADK** offer session services, in memory or over a database; OpenAI adds its own servers, and ADK scopes state keys by prefix (OpenAI guide §9, ADK guide §6).
- **Vercel** keeps no state; the `messages` array you pass back is the whole state, approvals included (Vercel guide §7).
- **LangChain** keeps state in a LangGraph checkpointer per `thread_id`, and a checkpointed agent refuses to run without one (LangChain guide §8).
- **Cloudflare** keeps state, messages, schedules and pending approvals in each agent's own SQLite database, which survives hibernation and eviction (Cloudflare guide §1, §7).

The tree is the most capable design, the plain array is the easiest to persist, and Cloudflare's database per agent ties state to a stable identity.

### Six of eight SDKs have a default that reaches outside your process

Six of the eight references found a default that sends data or credentials somewhere the developer didn't choose:
- **Claude:** the CLI inherits the parent's environment, so host credentials and tools reach the agent unless you pass an allowlisted `env` (Claude fact-check F5).
- **Copilot:** the runtime inherits `process.env`, signs in as the logged-in GitHub user and sends session telemetry unless you turn it off (Copilot guide §2, §12).
- **Pi:** without an explicit model, a session can authenticate to Bedrock or Vertex from ambient cloud credentials, and our first unscrubbed run did exactly that (Pi guide §2).
- **OpenAI:** tracing is on in Node.js and exports every run's model calls and tool calls to OpenAI's dashboard (OpenAI guide §2).
- **Vercel:** model strings route through Vercel's AI Gateway, and an approval response is unsigned unless you set `experimental_toolApprovalSecret` (Vercel guide §2, §7).
- **Cloudflare:** `sendIdentityOnConnect` defaults to `true`, so each WebSocket client receives the instance name, often a user id (Cloudflare guide §13).

LangChain and ADK are the exceptions. LangSmith tracing starts only when you set `LANGSMITH_TRACING=true` and a key (LangChain guide §2), and the ADK reference records no outward default. Their nearest traps point inward. A bare model id that LangChain's `initChatModel` can't map to a provider throws, which broke the docs' own first example (LangChain fact-check F1). ADK stores structured output that violates its schema, with no error event (ADK fact-check F10).

Each SDK documents its own default, so none of them is a bug. Together, though, they show a pattern: a convenient default for the first run becomes a leak in production. Our verification harnesses therefore share three defenses, which [AGENTS.md](../../AGENTS.md) now requires: an allowlisted environment, a network guard and a mock model that refuses host tools by name.

### The primary language decides how far a TypeScript reader can trust the docs

Three of the eight SDKs are Python first: OpenAI, LangChain and ADK ([TypeScript gap report](typescript-gaps.md#summary-google-adk-has-the-most-gaps-and-claudes-typescript-package-leads-its-python-sibling)). Their TypeScript packages match the core loop, and the gaps sit in the batteries around it: OpenAI's TypeScript package lacks 9 Python features, LangChain's 8 and ADK's 14. ADK also shows the reverse error. Its docs show 15 features only for Python that the 2.5.0 package already has, `requireConfirmation` among them ([gap report, ADK](typescript-gaps.md#google-adk-the-port-trails-python-by-14-features-but-the-docs-undersell-it-by-15)). Claude's and Copilot's TypeScript packages are first-class, and Claude's leads its Python sibling ([gap report, Copilot](typescript-gaps.md#github-copilot-sdk-typescript-is-a-first-class-sdk-and-lacks-only-rust-extras), [Claude](typescript-gaps.md#claude-agent-sdk-typescript-leads-python-and-trails-it-in-two-small-places)). Pi, Vercel and Cloudflare are TypeScript only. For a Python-first SDK, the pinned package's `.d.ts`, not the docs tag, says what exists.

## 3. Lessons for our SDK, harness and agent

Our planned stack has three layers, and each SDK teaches something about each one. The lists below say what to copy and what to avoid; Round G starts from them.

### The SDK layer: one model interface, composable stops and a first-party mock

Copy:
- **One model specification** that every provider implements, as Vercel's `LanguageModelV4` and pi-ai's provider interface do. Both let a test swap the model with one object (Vercel guide §1, Pi guide §12). Cloudflare shows the payoff: because both its chat classes call the AI SDK, the AI SDK's mock tests them unchanged (Cloudflare guide §12).
- **Composable stop conditions**, such as Vercel's `isStepCount`, `hasToolCall` and condition arrays, with an explicit cap on every loop (Vercel guide §5).
- **A first-party mock model in a `testing` export**, scripted by turns or computed from the request. `ScriptedModel`, `fauxProvider`, `MockLanguageModelV4` and LangChain's `fakeModel()` made five of the eight SDKs testable with one import, Cloudflare through the AI SDK. ADK needed a `BaseLlm` subclass, and Claude and Copilot each cost us a mock API (ADK guide §10, Copilot guide §11).
- **Typed errors for each way a run ends**, as OpenAI's `MaxTurnsExceededError` and Vercel's `NoObjectGeneratedError` do, rather than a status field you can forget to check.

Avoid:
- **Implicit routing.** Resolve a model only from an explicit provider, never from a hosted gateway, ambient cloud credentials or a logged-in user by default.
- **Default export of traces.** Ship OpenTelemetry spans or session telemetry to a backend only when the caller names one.
- **Schemas that only log.** ADK's `outputSchema` stores output that violates it (ADK guide §8). A declared schema should reject bad output with a typed error.

### The harness layer: a tree log, an explicit gate pipeline and resumable approvals

Copy:
- **Pi's tree-shaped session log**, with compaction as an appended summary entry, so neither branching nor compaction loses history (Pi guide §8, §9).
- **Claude's ordered permission pipeline**, with deny rules that always win. Make the order a documented, observable part of the API instead of a rule users must memorise (Claude guide §7). Copilot's order is a useful second model: `onPreToolUse` runs before the permission handler, so a hook can deny a call that no handler sees (Copilot guide §7).
- **Resumable approvals.** Store a paused run as data, as OpenAI's `RunState`, Vercel's messages, Cloudflare's SQLite rows and ADK's session events do, so a person can approve from another process (OpenAI guide §8, Cloudflare guide §9, ADK guide §9). Sign each approval request, as Vercel's `experimental_toolApprovalSecret` does, so a client can't forge one (Vercel guide §7). ADK adds a safe failure: a confirmation for a call id it never issued runs nothing (ADK fact-check F15).
- **Middleware with a fixed hook set.** LangChain's six hooks (`beforeAgent`, `beforeModel`, `afterModel`, `afterAgent`, `wrapModelCall`, `wrapToolCall`) carry every built-in feature, from summarisation to approval, so each one can be removed or ablated on its own (LangChain guide §5).
- **Steering queues.** Pi's `steer()` and `followUp()`, and Vercel's `experimental_steering`, let a user redirect a running loop at step boundaries without a race (Pi guide §7).
- **A stable identity per agent.** Cloudflare addresses each agent by name, and that name always reaches one instance with its own database, so state survives eviction (Cloudflare guide §1, §7). Our session log should key on such an identity.

Avoid:
- **A runtime process per session or client.** Claude's design costs about 1 GiB of RAM per agent, Copilot's costs one runtime per client, and both leave HTTP as the only test seam (Claude guide §1, Copilot guide §1).
- **Gates that silently skip or silently change.** A rule that makes a callback unreachable should fail loudly, not warn, and the documented default for a missing handler should match the code (Copilot fact-check F1).
- **Inherited environments.** Spawn every tool process with an allowlisted environment, the rule our harnesses now follow, and the default that Claude and Copilot both lack.
- **Mutating tools on by default.** Think's workspace tools and Copilot's 19 built-ins both arrive unasked (Cloudflare guide §8, Copilot guide §6). Our harness should offer the model no tool the agent didn't name.

### The agent layer: few tools, a gate per risk and a final tool for output

Copy:
- **A minimal tool surface.** Seven of the eight capstones removed the SDK's host tools or never had any. The Cloudflare capstone leaves Think's workspace tools on its triage turn, which a production agent should restrict with `activeTools` (Cloudflare guide §8). Start from zero tools and add each one for a reason.
- **Identity from trusted context.** The ADK and Copilot capstones read the customer from session state or the app's auth layer, so a model that invents another customer's id gets nothing (ADK guide §12, Copilot guide §13).
- **One gate per risk level.** Read-only tools run freely; each state-changing tool needs a person or a policy.
- **Typed output through a final tool**, which works on every provider, and re-validated by the agent where the SDK doesn't enforce it (section 1).
- **An explicit step cap, plus a spend cap where the SDK has one.** The Claude capstone sets both, and the Vercel and LangChain capstones set a step cap.

Avoid:
- **Relying on SDK defaults for limits.** The defaults ranged from 1 step (`generateText`) to 20 (`ToolLoopAgent`), 10 turns (OpenAI), 500 model calls (ADK) and no cap at all (Pi), so an agent should state its own (feature table, Loop control).

## 4. The docs were accurate on API surfaces and least accurate in examples, defaults and language tags

The eight fact-checks found the reference tables trustworthy almost everywhere. Claude, OpenAI, Vercel, LangChain and ADK documented options that all exist, Pi's reference pages matched its types exactly, and every SDK member the Cloudflare docs call exists. Imports are the exception: Copilot's hook pages import 11 types that the package root doesn't export, and Cloudflare's pages import 8 names that no entry point exports (Copilot fact-check F2, Cloudflare fact-check Tier 3). The errors sat in examples: six Pi README blocks, two OpenAI errors (a handoff name and a wrong "required" mark), twelve Vercel blocks that lag the release, a racy Claude interrupt example, and nine hand-written ADK page blocks (feature table, Operations). Cloudflare's and LangChain's examples were the least accurate: 58 of 1,927 Cloudflare blocks and 78 of 713 LangChain blocks disagree with the pinned release. Prose about defaults also went wrong. Copilot documents the opposite of its permission default, and Cloudflare documents a `hibernate` option that 0.33.0 ignores (Copilot fact-check F1, Cloudflare fact-check F10). Python-first docs mislabel TypeScript support in both directions, ADK's most of all (section 2).

Three process lessons follow for our own SDK's docs. First, publish docs from the release tag. Pi's site rendered its main branch ahead of the npm release, Cloudflare's two doc sites render branches, and the LangChain and ADK docs repos have no release tags at all. Second, type-check and run every example in CI against the published package, as OpenAI's `build-check` script does for its embedded files. Copilot's `docs-validate: strict` markers show that this works: none of its 68 strict-marked blocks has an API error (Copilot fact-check, Tier 1). Third, derive each language's support tags from that language's types, so a page can't deny a feature the package exports.

## Conclusion: build the loop we can own, and make every outward reach a setting

The eight SDKs converge on the same loop and differ on who controls it. Claude and Copilot give the most ready-made runtime with the least control, Pi the most control with no safety, and the other five sit between them with approvals that survive a restart. LangChain adds the most ready-made middleware, and Cloudflare the most durable home for an agent's state. For our own stack, the comparison points to one design. Build an in-process loop over a single model interface, as Vercel and Pi do. Keep a tree-shaped log keyed by a stable agent identity, as Pi and Cloudflare do, and run an ordered gate pipeline in which deny always wins, as Claude does. Approvals should be signed and resumable, as in OpenAI, Vercel, LangChain, Cloudflare and ADK. Features beyond the loop should be removable middleware with a small, fixed set of hooks, as LangChain's six are. Document the TypeScript surface from its own types, since our stack is TypeScript and Python-first docs mislead. Above all, make every reach outside the process an explicit setting, as LangChain does with tracing: model routing, identity, telemetry export and environment inheritance. Round G turns these lessons into research and build guides for the SDK, the harness and the agent.
