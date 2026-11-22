# Building an agent SDK: one streamed loop, failures and pauses kept as data, and a test model from the first release

- **Status:** guide for todo G1b, 2026-11-18. The [build-guides plan](../plans/build-guides.md#2-the-three-layers-defined) defines the layer; this guide turns the [agent-SDK research][sr] into a build plan for our own SDK.
- **Evidence (as of November 2026):** the [agent-SDK synthesis][sr], its [fact-check log][sfc] including the [R1 re-verification][sfc-r1], the five [research notes](../research/agent-sdk/notes/), the [Hacker News synthesis][hn], the eight verified references in [`docs/reference/`](../reference/), the [comparison docs](../comparison/), and the [main report][main] with its [fact-check log][fc]. SDK versions are the pins those files name, among them `ai@7.0.162`, `@openai/agents@0.21.0`, Pi 1.5.2, `langchain@1.6.1`, `@anthropic-ai/claude-agent-sdk@0.3.327`, `@github/copilot-sdk` 1.0.31, `@google/adk` 2.5.0 and `agents` 0.33.0 (Cloudflare).
- **Reader:** the engineers who will build our SDK. You know how an agent loop works; you have not read the eight references or the research behind them.

An agent SDK looks easy to build, because the loop at its centre is small: mini-swe-agent's whole control flow is `while True: step()` ([SDK research §2][sr2]), and Pi's loop core is about 950 lines ([deep comparison][dc-own]). The SDKs we verified still disagree on almost every default that matters. Their turn caps run from one model call to none, their retry counts from zero to six, and a tool error reaches the model as anything from a path-level message to "Please try again" ([SDK research][sr]). Their fact-checks add failures that no API table shows: a permission handler whose absence denies every call while the docs promise a pending request, an output schema that is never enforced, and docs that describe a branch instead of the release ([Copilot F1][cp-fc-err]; [ADK F10][adk-fc-sdk]; [Pi F1][pi-fc]). This guide takes each part of the SDK layer that [build-guides §1](../plans/build-guides.md#1-goal) lists in turn, from the model gateway to versioning and docs. For each part it gives the design we recommend, the alternatives the SDKs chose, and the evidence. It ends with a reference architecture and the decisions Round P must still make. The recommendation fits in one sentence: **build one in-process loop as a pure streaming function over a versioned single-method model gateway, return every failure and every pause to the caller as data in the transcript, and ship a strict scripted test model and release-tagged, compiled docs from the first release.**

## 1. The SDK owns the loop and its contracts, and the harness owns where state lives

The SDK is the library a developer imports to run a model-and-tools loop; the harness is the runtime that hosts it for real work ([build-guides §2](../plans/build-guides.md#2-the-three-layers-defined)). This guide stays on the SDK side of that line. The harness research has already claimed the session log format, the compaction layers and their triggers, and it leaves the SDK to define the `transformContext` interceptor those layers run through ([harness research §7][har7]). Permissions, sandboxing, the MCP registry and the interfaces (CLI, RPC, server) also belong to G2 ([build-guides §1](../plans/build-guides.md#1-goal)).

The boundary still puts work on the SDK, because every harness concern needs a seam the SDK must expose. The seams this guide names are:
- a **context transform** for compaction and pruning (§6);
- a **tool gate** that returns allow, deny or ask, for the permission pipeline (§6, §7);
- **authoritative end events** that the session log persists (§5);
- a **resume primitive**, `continue(context)`, that any process can call on a stored log (§3);
- a **tool-exposure field** and a deferred-loading hook, so the harness can add tool search and MCP servers (§4);
- a **base URL and transport override** on every adapter, which serves both offline mocks and eval bridges (§8).

The main report's architecture splits the same way: layer 1 is the model gateway and layer 2 the stateless loop, while the session store, context policy and sandbox are layers 3, 5 and 7 ([main report][main-arch]). The rest of this guide designs layers 1 and 2 and the contracts around them.

## 2. The model gateway should expose one versioned streaming method over a transcript the SDK owns

**Recommended design.** Each provider adapter implements one method, `stream(model, context, options)`, behind `specificationVersion: "v1"`. The method emits `start`, then a start, delta and end event for each text, reasoning or tool-input block, keyed by content index. It finishes with exactly one `done` or `error`, and a non-streaming `complete()` folds that stream ([SDK decision 1][sr6]). The SDK owns a provider-neutral transcript, keeps opaque provider tokens in typed fields, and runs one `transformMessages` pass before every request ([SDK decision 2][sr6]). A failed call returns a final assistant message with `stopReason: "error" | "aborted"`, its partial content and its usage; the SDK throws only for programmer errors ([SDK decision 3][sr6]). Retries, usage, cost and caching live in the gateway, not in each adapter ([SDK decisions 4–5][sr6]).

The SDKs draw this boundary in five different places ([SDK research §1][sr1]):

| SDK | Model boundary | Stream protocol | Errors | Default retries |
|---|---|---|---|---|
| Vercel | `LanguageModelV4`: `doGenerate` and `doStream`, tagged `specificationVersion: 'v4'` | text, reasoning and tool-input start, delta and end, keyed by id | streamed `error` part or thrown `APICallError` | 2, with a 2 s initial delay and factor 2 |
| Pi | `stream()` plus `streamSimple()`; `complete()` derives from the stream | `start`, block events, then exactly one `done` or `error` | in-band `stopReason` | vendor retries off; abortable backoff and a turn-level retry above it |
| OpenAI | `Model`: `getResponse` and `getStreamedResponse` | thin: tool calls arrive only in `response_done` | thrown | none unless a policy opts in |
| LangChain | `BaseChatModel` with an abstract `_generate` | content-block start, delta and finish | thrown | 6 (`AsyncCaller`) |
| Claude | none public; the model runs inside the CLI subprocess | raw Anthropic stream events, opt-in | result subtypes | inside the CLI |

**One method halves adapter work and removes a parity risk.** Pi derives its non-streaming call from the stream, so each adapter implements one method instead of two ([SDK research §1][sr1]). The two-method designs pay for the second method in every adapter, and the parity gap shows up one level higher: Vercel's `WorkflowAgent` caps `generate()` at 20 steps while `stream()` runs unbounded ([SDK research §2][sr2]). Pi also guarantees that no update arrives before `start` and that the stream ends with exactly one terminal event, which is the guarantee a loop needs to close a message cleanly ([SDK research §1][sr1]).

**Cross-provider replay needs one explicit, tested transform pass.** Reasoning signatures are valid only for the model that produced them, so Pi's `transformMessages` drops thinking from a different model, strips foreign signatures, remaps tool-call ids to the target's charset, replaces images for text-only models, skips errored turns and gives orphaned tool calls a synthetic error result ([SDK research §1][sr1]). Vercel reaches a similar result through namespaced `providerOptions`, but it drops unsigned reasoning with only a warning; OpenAI routes every provider through its Responses item model ([SDK research §1][sr1]). We reject both as the source of truth and keep `providerOptions` only as an escape hatch beside an `onPayload` request rewrite ([SDK decision 2][sr6]). Pi also separates the wire protocol (`api`) from the vendor (`provider`), which is how 10 adapters serve more than 40 vendors ([provider note §3][n-prov-3]).

**Failures in the transcript keep partial output and let the loop classify them.** An in-band error keeps the partial content and usage in the log, so the loop can decide whether a failure is retryable, a context overflow or fatal ([SDK decision 3][sr6]). Vercel, OpenAI and LangChain throw instead ([SDK research §1][sr1]). The deep comparison asks for typed errors "for each way a run ends", because a status field is easy to forget to check ([deep comparison][dc-sdk]); §3 resolves that tension for run outcomes and §12 lists it as an open decision.

**Retries need three layers and replay-safety rules.** First, HTTP retries before any output are safe; Pi turns vendor-SDK retries off because "their built-in retry timers ignore the request AbortSignal". Second, a mid-stream retry is unsafe, so OpenAI refuses to replay once output has started, after a timeout or on a stateful request unless a policy approves. Third, above the model, Pi retries whole turns but treats quota and billing errors as final ([SDK research §1][sr1]). We take Vercel's default of 2 HTTP retries rather than OpenAI's zero or LangChain's six, and each retry emits a `retry` event, as Claude's `api_retry` does ([SDK decision 4][sr6]).

**Usage and cost belong on every assistant message, with one token convention.** Vercel's Anthropic adapter reports input as uncached input plus both cache classes, while Pi stores uncached input alone, and only Pi and Claude compute cost ([SDK research §1][sr1]). Our usage records uncached input, cache read, cache write by TTL, output and reasoning, plus a raw snapshot; cost carries a `basis` flag, comes from a catalog with tiered rates, and counts failed attempts too ([SDK decision 5][sr6]). Prompt caching is one portable `cacheRetention` policy with Pi's automatic breakpoints on the system prompt, the last tool and the last user or tool-result block ([SDK decision 5][sr6]). To keep cache hits after a resume, the gateway persists the exact frozen system prompt ([main report review, item 4][fc-review]).

**Practitioners confirm the gateway and change one rule in the main report.** Quota and cost opacity is the most widely raised complaint in 18 months of Hacker News threads (view 1, ~570 authors), and the HN synthesis confirms usage and cost on every message ([HN §1][hn1]; [HN §4.1][hn41]). Users switch models monthly and pair one model's writing with another's review, which supports the provider-neutral transcript and an explicit provider; they also ask for a way to dump the full request for any step, because opacity is their main case against frameworks (view 8, ~185 authors) ([HN §4.1][hn41]). Practitioners and the main report disagree on routing. Layer 1 of the main report lists "routing easy work to smaller models", but ~45 authors route by role, and they report that changing the model or effort mid-session busts the cache ([HN §2.2, row 14][hn22]). The gateway should therefore offer a per-subagent model setting and no automatic per-request router ([HN §4.1][hn41]).

## 3. The loop should be one in-process pure function, capped in model calls, that ends with a stop reason

**Recommended design.** The loop is one pure streaming function over a context, and `continue(context)` is its resume primitive; the non-streaming API only collects its events ([SDK decision 6][sr6]). The default cap is 20 model calls plus an optional USD cap, and a run that hits either ends with a stop reason, not an exception. One step is one model call, approval resolution is not charged as a step, and the SDK warns when the cap fires ([SDK decision 7][sr6]). Every abort leaves a well-formed transcript, and steering drains only at step boundaries ([SDK research §2][sr2]).

**Three loop shapes exist, and only the in-process one combines full control with cheap offline tests.** They differ in who holds the loop state ([SDK research §2][sr2]). The in-process shape (Vercel, Pi, OpenAI, LangChain) holds it in the JavaScript heap for one call. The subprocess shape (Claude, Codex's TypeScript SDK) holds it in a CLI process. The durable shape (Vercel `WorkflowAgent`, Temporal adapters, Anthropic Managed Agents) holds it in an external event history. The Copilot SDK joins the subprocess group: it drives the Copilot runtime over JSON-RPC, and the runtime owns the loop, retries and compaction ([Copilot guide §1][cp-g1]). The shapes trade control, testability and safety differently:

| | In-process | Subprocess | Durable |
|---|---|---|---|
| Control | full: hooks at every phase | options, hooks and control requests only | full, within determinism rules |
| Offline test | a test model in-process | a mock provider API behind a base URL | the workflow runtime or its test harness |
| Crash | loses the turn | loses the process; the transcript survives | loses nothing committed |

The table condenses the [loop note §11][n-loop-11]. A Claude session costs a CLI process of about 1 GiB of RAM and leaves HTTP as the only test seam ([deep comparison][dc-harness]), so the subprocess shape stays a deployment option for the harness, not the core ([SDK research §2][sr2]).

**One loop for both modes makes streaming parity free.** Pi has one loop that always streams, and its non-streaming API returns the final `agent_end` messages. Vercel and OpenAI keep two loop implementations each, with duplicated stop logic ([SDK research §2][sr2]). A durable engine then becomes an adapter over the log rather than a second loop. Temporal's adapters show what that adapter must decide per tool: model calls become activities automatically, but tools do not. The OpenAI Agents integration runs `@function_tool` tools in the workflow unless they are wrapped with `activity_as_tool()`, and the Vercel plugin requires I/O tools to be written as activities ([SDK fact-check, R1][sfc-r1]). Durable tool dispatch is therefore a per-tool choice, which is why the SDK exposes a per-tool execution setting (§4).

**Default caps range from a footgun to no limit, so the SDK must pick one and count it in model calls.** The defaults we verified are:

| SDK | Default cap | At the cap |
|---|---|---|
| Vercel `generateText` | 1 step | stops after one model call, before the model sees any tool result |
| Vercel `ToolLoopAgent` | 20 steps, with a warning | returns normally |
| OpenAI `run()` | 10 turns | throws `MaxTurnsExceededError` |
| LangChain `createAgent` | 25 graph super-steps, which allowed 13 model calls in our test | throws `GraphRecursionError` |
| Pi `agentLoop` and Claude | none | the host stops the run; Claude's `maxTurns` ends in `error_max_turns` |

The table comes from [SDK research §2][sr2]. ADK adds a fifth unit, a default limit of 500 model calls that raises `LlmCallsLimitExceededError` ([ADK F16][adk-fc-sdk]). What counts as a turn matters as much as the number: OpenAI does not charge approval resolution as a turn, and Claude counts the final text-only answer as one ([SDK research §2][sr2]). Callers reason in model calls, so the SDK counts model calls, and every agent should still set its own cap rather than trust a default ([deep comparison][dc-agent]).

**A stop reason is safer than an exception for run outcomes, but it must be impossible to ignore.** The research sides with Claude's result subtypes over OpenAI's `MaxTurnsExceededError` and LangChain's `GraphRecursionError` ([SDK decision 7][sr6]); the deep comparison prefers typed errors, which a caller cannot forget to check ([deep comparison][dc-sdk]). Both concerns hold if the run result is a discriminated union whose `stopReason` TypeScript forces callers to narrow, and if a thin `runOrThrow()` helper converts non-success outcomes into typed errors that carry the resumable state, as OpenAI's `AgentsError.state` does ([hooks note §4][n-hooks-4]). Round P should confirm this split (§12, decision 10).

**Practitioners add progress detection and an earlier budget check.** Loops cause the runaway-cost anecdotes in the HN corpus: "Nobody could tell me if the agent was stuck in a loop, which sessions were expensive" ([HN §4.1][hn41]). The HN synthesis therefore adjusts SDK decision 7 in three ways ([HN §4.1][hn41]):
- a default `shouldStop` policy that fires on repeated identical failing tool calls or repeated edits to the same lines, with its own stop reason;
- a default cap on subagent depth;
- a USD cap checked before each model call, not after it.

The harness research raises the same timing question: Claude's and mini-swe-agent's budgets act only after the response that crosses them, as Claude's docs state for `maxBudgetUsd`, and harness decision 18 asks for a pre-emptive check ([harness research §7][har7]; [feature table][ft-loop]). We recommend the pre-emptive check, using the input token count of the next request and the model's price, and list the rule for Round P (§12, decision 9).

**Abort and steering each have a race the loop must close.** Pi's parallel dispatch `break`s on abort, so some tool calls can end with no result message; Pi and Vercel drain steering only at step boundaries, and Vercel adds a delivery receipt per steered message ([SDK research §2][sr2]). Our abort therefore gives every open tool call an aborted error result and closes the assistant message with `stopReason: "aborted"`, and an `agent_settled` event fires only after retries have stopped ([loop note, implication 8][n-loop-impl]). Steering is an API, `run.steer()` and `run.followUp()`, drained at step boundaries with delivery receipts, and it never cuts a running tool batch ([SDK decision 12][sr6]).

## 4. Tools should take Standard Schema, validate inside the SDK, and return every failure to the model as data

**Recommended design.** A tool schema is a `StandardSchemaV1` that also implements `StandardJSONSchemaV1`, or raw JSON Schema checked by a bundled eval-free validator ([SDK decision 9][sr6]). Each provider adapter lowers the canonical schema to its strict form and strips the nulls it added before validation. Every call runs a fixed pipeline: resolve the name, coerce, validate, an optional `repair`, the policy gate, `execute`, then `afterToolCall`. Any failure becomes an `isError` result with path-level messages and the received arguments, so nothing throws out of the loop ([SDK decision 10][sr6]). Tools run in parallel by default and serialise per tool or per resource, and each result has three channels ([SDK decision 11][sr6]).

**Validation belongs in the SDK, because provider strict mode leaves gaps.** Vercel's raw JSON Schema and dynamic MCP tools reach `execute` unvalidated unless a validator is passed, and OpenAI's raw schemas rely on constrained decoding ([SDK research §3][sr3]). The SDKs also disagree on the message the model sees when input fails:

| SDK | Schema input | Error text the model sees |
|---|---|---|
| Pi | any JSON Schema, validated with coercion | each error path plus the received arguments |
| LangChain | Zod or JSON Schema 7, both validated | prettified Zod issues; other errors end "Please fix your mistakes." |
| ADK | Zod, validated before `execute` | `{ error }` carrying the Zod issues |
| Vercel | Zod, Standard Schema, `jsonSchema()` | `Invalid input for tool X: <cause>` |
| OpenAI | Zod, Standard Schema, JSON Schema; `strict` on by default | "An error occurred while running the tool. Please try again." |
| Claude | Zod raw shape only, on an in-process MCP server | an MCP error result |

The rows come from [SDK research §3][sr3] and, for ADK, [ADK F14][adk-fc-sdk]. The error text decides whether the model can self-correct: the MCP specification warns that otherwise "the LLM would not be able to see that an error occurred and self-correct", and Anthropic's tool guide asks for errors that "clearly communicate specific and actionable improvements" ([SDK research §3][sr3]). Pi's path-level message is the one to copy, and redaction becomes an opt-in per tool rather than OpenAI's generic default ([SDK decision 10][sr6]).

**Tool errors should also tell the model what not to do next.** Practitioners report agents that answer a failed tool by inventing data: "It looks like the read tool failed, that's ok, I can just make a mock implementation and comment out the test for now" ([HN §4.1][hn41]). The HN synthesis therefore adjusts SDK decisions 3 and 10: a tool error message should say, for example, not to substitute a mock ([HN §4.1][hn41]). The SDK's default error formatter should include that instruction, and tools can override it.

**A truncated response must fail its tool calls rather than run salvaged JSON.** Pi fails every tool call in a `length`-stopped message with a "re-issue" error instead of executing partial arguments ([SDK research §3][sr3]). Repair sits before that error as a cheap hook: Vercel's `repairToolCall` runs only for an unknown tool or invalid input and may return a fixed call that is parsed again, while Pi's `prepareArguments` shims old argument shapes ([tools note §4][n-tools-4]). Most failures should cost one extra model turn with a precise message, not a second model call ([tools note §4][n-tools-4]).

**Parallel execution is the default everywhere except ADK, and safety comes from per-tool classes.** Every in-process SDK in the synthesis starts all calls of a step at once and appends results in model order ([SDK research §3][sr3]). ADK's TypeScript port, checked later, is the exception: it awaits each call in turn, where Python has run them concurrently since 1.10.0 ([ADK F11][adk-fc-sdk]). Only Pi lets a tool force its batch sequential, and only its file tools serialise per path, so "operations for different files still run in parallel" ([SDK research §3][sr3]). Our gates run sequentially in model order, results append in model order, and tools receive a signal that cancels their siblings ([SDK decision 11][sr6]). MCP annotations such as `readOnlyHint` are untrusted hints, which the specification says clients "should never make tool use decisions" on for untrusted servers, so they affect scheduling only for first-party tools ([SDK research §3][sr3]; [SDK decision 11][sr6]).

**Tool results need three channels so the model, the UI and code each get what they need.** Pi separates `content` for the model, `details` for the UI and log, and `structuredContent`, which is "not sent to the model" ([SDK research §3][sr3]). Our result type carries `content`, `details`, `structured`, `isError` and `terminate` ([SDK decision 11][sr6]). The `terminate` flag also gives portable structured output: at least three of the eight SDKs in the deep comparison get typed output from a final tool call, and a final tool works on every provider that calls tools ([deep comparison][dc-same]). ADK shows why the SDK must validate that output itself, because its `outputSchema` violations are only logged and the run succeeds ([ADK F10][adk-fc-sdk]).

**The SDK defines tool kinds, names and exposure, and leaves the registry to the harness.** Vercel models four kinds best: `function`, `dynamic`, provider-defined tools that run locally, and provider-executed tools that run server-side ([tools note §10][n-tools-10]). Names are namespaced by source (`mcp__<server>__<tool>`) and sanitised to the strictest provider, and tool order stays stable for prompt caching ([tools note §8][n-tools-8]). Every tool carries an `exposure` of `direct | deferred | hidden`, because deferred loading cut tool-definition context from about 77K to 8.7K tokens in Anthropic's measurements and practitioners confirm the cost of always-loaded definitions ([tools note §9][n-tools-9]; [HN §2.2, row 2][hn22]). The MCP adapter must keep `isError`, which Vercel's adapter returns as a normal value and OpenAI keeps only for its data extractor ([SDK research §3][sr3]). The MCP client, its registry and tool search belong to the harness ([build-guides §1](../plans/build-guides.md#1-goal)); the SDK supplies the tool type and the exposure field they plug into.

## 5. The event stream should be one closed, layered union whose end events carry the authoritative item

**Recommended design.** The SDK emits one discriminated union in two layers: deltas keyed by content index, and an item layer in which every `*_end` event carries the authoritative item that the session log persists ([SDK decision 13][sr6]). Raw provider events are opt-in. The union is closed: the SDK never emits an event type the union does not declare, and a new type ships behind the versioning rules of §10.

**Every block-level vocabulary converges on start, delta and end per block, with one terminal event.** Vercel keys stream parts by string id, Pi by `contentIndex` with a live `partial` message, and LangChain by block index; OpenAI's model stream is the exception, with tool calls arriving only in `response_done` ([SDK research §1][sr1]). Pi's wire rule is the one to copy: "`message_start` provides the initial message, deltas build it, and `message_end` provides the final authoritative message" ([SDK research §4][sr4]). That rule lets a UI render deltas and lets the log store only end events, which matches the harness's open question on log granularity ([harness research §9][har9]).

**Run-level streams vary in size and level, so one union must serve both UIs and logs.** Vercel's `TextStreamPart` has 26 members, Claude's `SDKMessage` 40, and OpenAI wraps completed run items in 10 event names; LangChain streams at graph level through `streamMode`s ([SDK research §4][sr4]). The hooks note proposes a small union: run, step and model-call start and end; text, reasoning and tool-input start, delta and end; tool-call start, update and end; plus `approval_request`, `steer_applied`, `compaction`, `hook_error`, `error` and `abort` ([hooks note, implication 4][n-hooks-impl]). We adopt that list as the starting point.

**An open or drifting union breaks exhaustive code silently.** The Copilot runtime emits ten `model.*` event types that its 191-member typed `SessionEvent` union omits, so a `switch` that TypeScript treats as exhaustive meets undeclared values ([Copilot F6][cp-fc-types]). Field renames inside a union break just as quietly: Vercel 7 moved `text-delta` text from `textDelta` to `text`, and three doc examples that still read `textDelta` print nothing ([Vercel F1][v-fc]). Our CI should compare the emitted event types against the declared union in every test run, and a rename should ship as a new field beside the old one (§10).

**Telemetry is a projection of the same events, with content off by default.** OTel GenAI agent spans (`invoke_agent`, `execute_tool`) are still at Development stability, and their tool-argument and result attributes are opt-in because they may be sensitive ([hooks note §6][n-hooks-6]; [main report][main-evals]). The SDK ships one built-in observer that maps events to `gen_ai.*` spans, with content attributes opt-in ([SDK decision 13][sr6]). The observer exports only to a backend the caller names, because OpenAI's default export of every run to its dashboard is one of the outward-reaching defaults in §9 ([deep comparison][dc-sdk]). Practitioners agree from the other side: the one value they grant frameworks is tracing, and they debug from local transcripts and OTel data rather than LLM-ops products ([HN §1][hn1]; [HN §4.2][hn42]).

## 6. Hooks should be six typed interceptors and separate observers, each taking one event object

**Recommended design.** The SDK separates observers, which cannot change a run, from interceptors, which return a decision or a replacement, and gives them different types ([SDK decision 12][sr6]). The six interceptors are `beforeModelCall`, `transformContext`, `afterModelCall`, `beforeToolCall`, `afterToolCall` and `shouldStop`. Each receives one event object with `runId`, `stepIndex`, `callId` and `signal`, returns a new value instead of mutating its input, and, for gates, fails closed unless an `onFailure` override says otherwise ([SDK decision 12][sr6]). Model middleware sits at the gateway with Vercel's three slots, `transformParams`, `wrapGenerate` and `wrapStream`, composed first-is-outermost ([SDK decision 13][sr6]).

**The SDKs agree on the moments and differ by an order of magnitude in surface.** OpenAI has 5 observe-only lifecycle events, and LangChain has 6 middleware hooks that carry 21 built-in middleware factories. Vercel has 8 stable lifecycle callbacks plus `prepareStep`, `toolApproval` and middleware. At the large end, Claude has 33 hook events, and Pi has 10 core events plus 41 extension events, 18 of which can intervene ([SDK research §4][sr4]). LangChain's count shows that six hooks can carry a whole feature set, from summarisation to call limits and human approval ([SDK research §4][sr4]). We match that count but name the hooks by model and tool moment, as [AGENTS.md](../../AGENTS.md) item 2 of the planned architecture lists them, so LangChain's run-level `beforeAgent` and `afterAgent` become observers ([SDK decision 12][sr6]).

**Four interceptor rules come from four observed failures.**
1. **A gate fails closed.** Pi's tool gate rethrows handler errors and blocks the call, while Claude's `onFailure` defaults to `continue` ([SDK research §4][sr4]).
2. **A hook returns a new value.** Pi's `tool_call` rewrites arguments in place, while Claude's `updatedInput` and Pi's own `afterToolCall` return replacements, which are easier to type and audit ([SDK research §4][sr4]).
3. **A hook takes one event object.** OpenAI's own source calls its positional arguments a regret: "Changing the list is a breaking change" ([SDK research §4][sr4]). ADK shows the cost from the caller's side: its plugin example declares positional parameters where `BasePlugin` hooks take one object, so `context` arrives `undefined` at run time, and its agent callbacks and plugin hooks name the same parameters differently ([ADK F1][adk-fc-doc]; [ADK F12][adk-fc-sdk]).
4. **An interceptor receives an abort signal**, as Pi's and Claude's do and Vercel's observers do not ([SDK research §4][sr4]).

**Hook types must match what the runtime accepts and what the docs show.** Copilot's hook pages return `null` 50 times, which every handler type rejects and the runtime accepts, and they import ten hook types the package root does not export ([Copilot F2, F4][cp-fc-types]). Both are type-surface bugs that a compiled-docs check (§10) catches. The hook contract also needs a written order. Claude's `canUseTool` silently never runs for a tool also listed in `allowedTools`, and the SDK warns only through a Node warning ([deep comparison][dc-safety]). A rule that makes a hook unreachable should fail loudly ([deep comparison][dc-harness]).

**Observers must never break a run, and their errors become events.** Vercel swallows observer errors ([SDK research §4][sr4]). Our observers get `(event) => void | Promise<void>`, and a thrown error becomes a `hook_error` event rather than a loop failure ([hooks note, implication 1][n-hooks-impl]). `on()` returns an unsubscribe function, as Pi's does ([hooks note, implication 3][n-hooks-impl]).

**Practitioners endorse thin hooks and reject the framework around them.** LangChain draws ~46 authors across 34 threads, almost all negative, and the shared objection is that frameworks obscure what is sent to the model ([HN §1][hn1]). The deep comparison, built from vendor docs and our tests, recommends LangChain's six-hook middleware as the pattern to copy ([deep comparison][dc-harness]). The two views agree once the objection is located: practitioners reject hidden prompts and forced idioms, not a small hook set. Our SDK keeps the hooks and makes them inspectable, with the full-request dump of §2 and a documented reference loop (§9).

**The context transform and the tool gate are the harness's two main seams.** `transformContext(messages, signal)` is where compaction and pruning run, and the harness research assigns the layers and triggers to G2 while the SDK owns the interceptor ([hooks note, implication 2][n-hooks-impl]; [harness research §7][har7]). `beforeToolCall` returns `allow | deny | ask` with an optional replacement input and reason, which is the shape the harness's permission pipeline needs ([hooks note, implication 2][n-hooks-impl]). The pipeline itself, its rule order and its modes are G2's ([harness research §3][har3]).

## 7. An approval should end the run in a signed, resumable log state, not block a callback

**Recommended design.** When a gate returns `ask`, the run ends with `stopReason: "awaiting_approval"`, persists the pending call and resumes when a decision event is appended ([SDK decision 8][sr6]). Each pending request is HMAC-signed over its id, the call id, the tool name and a hash of the canonical input, and the SDK revalidates it on resume. An in-memory blocking gate stays available as a convenience for CLIs and tests ([SDK decision 8][sr6]).

**Pauses take two forms, and only the one stored as data survives a restart.**

| SDK | Pause form | Resume |
|---|---|---|
| OpenAI | serialised `RunState` | `RunState` string, then `approve()` or `reject()` |
| Vercel | the message array | append a `tool-approval-response` and call again |
| LangChain | checkpoint interrupt per `thread_id` | `Command({ resume: { decisions } })` on the same thread |
| Cloudflare | the agent's own SQLite | a `cf_agent_tool_approval` frame over a WebSocket |
| ADK | session events | a `functionResponse` on the same session |
| Claude, Pi | blocking callback | none: the pause dies with the process |
| Copilot | a held request (`no-result`) | a reviewer answers the live session |

The first three rows and Claude and Pi come from [SDK research §2][sr2]; the deep comparison adds the three later SDKs ([deep comparison][dc-same]). Its capstones show the practical difference: the five data forms let a person decide hours later, in another process or on another connection, while Copilot's `no-result` holds the call open only for the live session ([deep comparison][dc-same]).

**Signing must be on by default, because a stored history is untrusted input.** Vercel's optional HMAC signing stops a forged history from approving a call, but approval responses are unsigned unless `experimental_toolApprovalSecret` is set ([SDK research §2][sr2]; [deep comparison][dc-reach]). Vercel also revalidates a resumed call's input and rejects it if refinement changed it ([tools note §4][n-tools-4]). ADK shows the safe behaviour for a forged id: a confirmation whose call id ADK never issued runs nothing, and the tool asks again ([ADK F15][adk-fc-sdk]). Our resume fails closed on a missing or invalid signature; who owns the key is open (§12, decision 5).

**A missing approval handler must fail closed, and the docs must say so.** Copilot's session without `onPermissionRequest` denies every tool call at once, while its README and JSDoc say requests are "emitted as events and left pending" ([Copilot F1][cp-fc-err]). Denial is the safe default; the documented pending state is the bug. Our SDK documents the no-handler outcome in the type of the gate option and tests it in the behavioral examples.

**The blocking convenience must write its pause before it blocks.** The harness research shows that a blocking pause dies with its process, so it accepts a blocking gate only in the in-process transport and requires the `approval_requested` entry to be written first, so a crash still leaves a resumable state ([harness research §7][har7]). Our blocking gate is a thin wrapper over the data form for that reason: it emits the pending call, waits, then appends the decision.

**Practitioners add a clarification pause.** About 60 authors across ~53 threads wish the agent had asked instead of guessing, so the HN synthesis adds a `clarification_requested` pause that lets the agent ask a question through the approval machinery ([HN §4.1][hn41]). The SDK adds it as a second pause kind with the same storage, signing and resume path. Practitioners also distrust approval prompts themselves. Approval fatigue drives them to run without prompts inside a sandbox (view 2, ~440 authors), and they reject the vendor default that lets a classifier approve calls ([HN §1][hn1]; [HN §2.2, row 8][hn22]). Those choices sit in the harness's permission and sandbox policies; the SDK's job is to make every pause cheap, durable and explicit.

## 8. The SDK should ship a strict scripted test model in a `testing` export from the first release

**Recommended design.** `@buildanagent/sdk/testing` centres on a strict `ScriptedModel` with fixed and responder steps, frozen request snapshots, a typed over-run error and `assertComplete()` ([SDK decision 14][sr6]). Beside it ship an `autoResponder` with a host-tool deny list, realistic chunked streams, scripted doubles for the sandbox, approval and MCP seams, a mock transport per adapter, and `allowModelRequests(false)`. The core makes `clock`, `idGenerator` and `random` stable run options ([SDK decision 14][sr6]).

**Four of the eight SDKs ship a test model, one borrows another's, and three ship none.** Pi ships `fauxProvider`, OpenAI `ScriptedModel`, Vercel `MockLanguageModelV4` in `ai/test`, and LangChain `fakeModel()` ([SDK research §5][sr5]). Cloudflare's agents reuse Vercel's mock, because both chat classes call the AI SDK ([Cloudflare guide §12][cf-g12]). The other three ship none:
- **Claude:** our harness mocks the Messages API over HTTP and had to reimplement the CLI's tool-search step ([SDK research §5][sr5]).
- **Copilot:** the harness serves a mock Anthropic API to the runtime through a BYOK provider, inside a network namespace ([Copilot guide §11][cp-g11]).
- **ADK:** offline tests need a `BaseLlm` subclass, and requests must be copied because ADK reuses and mutates them between steps ([ADK guide §10][adk-g10]).

Claude and Copilot pushed our tests down to a mock HTTP API, and ADK made every test suite write its own model class. A first-party `testing` export removes both costs.

**A test model is worth what it lets a test assert, and only OpenAI's covers every case.**

| Test model | Records requests | Over-run | Under-run |
|---|---|---|---|
| OpenAI `ScriptedModel` | frozen, detached snapshots | throws `UnexpectedModelCallError` | `assertComplete()` throws |
| LangChain `fakeModel()` | a shallow copy of `messages` | throws "no response queued" | no assertion |
| Pi `fauxProvider` | no; `callCount` only | stream error | `getPendingResponseCount()` |
| Vercel `MockLanguageModelV4` | raw options object | array form returns `undefined` | nothing |

The table comes from [SDK research §5][sr5]. Vercel's silent exhaustion forced us to wrap the mock so it throws `no turn N`, and LangChain's older `FakeStreamingChatModel` cannot drive a tool loop at all, because it replays its first response and drops its tool calls ([SDK research §5][sr5]; [LangChain F8][lc-fc]). OpenAI recommends `assertComplete()` in teardown so that "an early workflow exit is reported even when another assertion fails first" ([testability note §2][n-test-2]). A recorded request must be a detached snapshot, because an array that aliases the runner's live history keeps changing after the call ([SDK research §5][sr5]).

**Deterministic tests need realistic streams and injected ids.** pi-ai's test model splits text and tool-call JSON into token-sized chunks through the production parser and checks abort between chunks, yet it takes ids and chunk sizes from `Date.now()` and `Math.random()` ([SDK research §5][sr5]). Vercel exposes `_internal: { generateId, now }` but documents it as "For test use only. May change without notice" ([SDK research §5][sr5]). Our run options make all three public and stable, so a second run of a snapshot test produces a byte-identical log ([testability note, CI rules][n-test-impl]).

**Five safety rules came from five failures, and the SDK should build in the ones it can.** Our verification runs needed an allowlisted environment instead of `...process.env`; no fallthrough to an ambient real provider, after a Pi example reached Amazon Bedrock; a network guard; a host-tool deny list matched by name, after OpenAI's `exec_command` slipped past a type filter; and finite scripts with SIGKILL timeouts ([SDK research §5][sr5]). Pydantic AI's `ALLOW_MODEL_REQUESTS = False` puts the second rule into the SDK, which is the model for our `allowModelRequests(false)` ([SDK research §5][sr5]). The deny list belongs in `autoResponder`, and the other rules belong in our CI ([testability note, CI rules][n-test-impl]).

**Record and replay work best at the normalised boundary.** None of the four TypeScript SDKs the testability note examined ships record and replay, and HTTP cassettes go stale and can leak credentials ([testability note §6][n-test-6]). A recorded pair of normalised request and response survives wire-format changes, replays through `ScriptedModel`, and fits the append-only log; each recording needs an SDK, provider and model stamp and an expiry ([testability note §6][n-test-6]).

**Unit tests and evals answer different questions, and the SDK's share of evals is a base-URL override.** OpenAI's guide says "model quality, instruction following, and tool-selection quality belong in evaluations or tests that use a real model" ([SDK research §5][sr5]). The eval machinery belongs to the harness; the SDK's share is a gateway whose base URL callers can override, which serves both our offline mock and Inspect's sandbox bridge ([SDK research §5][sr5]). Practitioners raise the same split: tests, types and linters are the oracle they trust (view 4, ~380 authors), and they reject single-run comparisons as noise ([HN §1][hn1]; [HN §2.2, row 11][hn22]).

## 9. The public API should be functions with options objects, an explicit provider, and nothing that reaches outside the process by default

**Recommended design.** The SDK's entry points are functions that take one options object and return a result with stream views; classes appear only where state lives, such as a long-running `Run` with `steer()` and `abort()` ([hooks note §4][n-hooks-4]). The model factory never guesses: it resolves a model only from an explicit provider, never from a bare model id or ambient cloud credentials ([SDK decision 14][sr6]). Every behaviour that sends data or credentials out of the process is off until the caller names it ([deep comparison][dc-reach]).

**Functions with options objects won, and positional arguments became a regret.** Vercel's `generateText` and `streamText` each take one options object and return a result with promise getters and stream views; Claude's `query()` returns an async generator with control methods; OpenAI's `Agent` and `Runner` are classes whose positional hook arguments its own source regrets ([hooks note §4][n-hooks-4]). Typed errors should carry resumable state, as OpenAI's `AgentsError` does, and use an `isInstance` marker rather than `instanceof`, as Vercel's `AISDKError` does across duplicated bundle copies ([hooks note, implication 6][n-hooks-impl]).

**Six of the eight SDKs we verified have a default that reaches outside the process** ([deep comparison][dc-reach]):
- **Claude:** the CLI inherits the parent's environment, so host credentials and tools reach the agent unless you pass an allowlisted `env`.
- **Copilot:** the runtime inherits `process.env`, signs in as the logged-in GitHub user and sends session telemetry unless you turn it off.
- **Pi:** without an explicit model, a session can authenticate to Bedrock or Vertex from ambient cloud credentials, and our first unscrubbed run did exactly that.
- **OpenAI:** tracing is on in Node.js and exports every run's model and tool calls to OpenAI's dashboard.
- **Vercel:** model strings route through Vercel's AI Gateway, and approval responses are unsigned without `experimental_toolApprovalSecret`.
- **Cloudflare:** `sendIdentityOnConnect` defaults to `true`, so each WebSocket client receives the instance name, often a user id.

LangChain and ADK are the exceptions, with LangSmith tracing opt-in and no outward default recorded for ADK ([deep comparison][dc-reach]). Two SDKs also hand the model mutating tools unasked: Copilot's default session offers 19 built-ins, `bash` and `edit` among them, and Think offers `write`, `edit` and `delete` on its workspace in every turn ([Copilot F8][cp-fc-def]; [Cloudflare F4][cf-fc-sdk]). Each default is documented, so none is a bug, but together they show a convenient first-run default becoming a production leak ([deep comparison][dc-reach]). Our SDK makes model routing, identity, telemetry export, environment inheritance and default tools explicit settings.

**Practitioners want a reference loop they can read beside the full one.** A thin loop you can read beats a framework for ~185 HN authors (view 8), and the Princeton SWE-bench team reports an agent "in ~100 lines of code that does pretty well on SWE-bench" ([HN §1][hn1]). The counter-view matters for an SDK: ~25 authors say the small loop's missing 10% (error handling, timeouts, context management, UI) is the real work ([HN §1][hn1]). Both views support the same deliverable: a full loop that owns retries, errors and aborts, plus a documented reference loop of a few hundred lines beside it ([HN §4.1][hn41]).

**The package layout should let the gateway version apart from the loop.** pi-ai and pi-agent-core ship as separate packages, while Vercel versions its provider contract separately from `ai` through `specificationVersion` ([SDK research §8][sr8]; [hooks note §5][n-hooks-5]). Whether we ship one package with subpath exports or several packages is open (§12, decision 1), but the provider spec must carry its own version either way.

## 10. Versioning must cover defaults and prompts as well as types, and docs must compile against the release tag

**Recommended design.** The versioning policy has four rules: unstable surface carries an `experimental_` prefix; renames ship as aliases in a minor release and leave in the next major; no patch release carries a breaking change; and `run_start` advertises a capability list ([SDK decision 13][sr6]). The policy also covers defaults, built-in prompts and tool descriptions: each change gets a changelog entry and a setting that keeps the old value ([HN §4.1][hn41]). Docs, an `llms.txt` and a compact docs index build from the release tag, and CI compiles and runs every example against the published package ([SDK decision 13][sr6]; [HN §4.1][hn41]; [deep comparison][dc-docs]).

**Versioning practice ranges from a full pipeline to breaking changes in patch releases.**

| SDK | Strategy | Evidence |
|---|---|---|
| Vercel | `experimental_` → stable → removed, with `@deprecated` aliases; spec-versioned providers upgraded through `Proxy` shims | 143 `@deprecated` tags in `ai/dist/index.d.ts`; V2 and V3 models run on V4 |
| Claude | runtime capability negotiation | `interrupt()` returns a receipt only on CLIs advertising `interrupt_receipt_v1` |
| LangChain | behaviour versions inside the API | `createAgent({ version: "v1" \| "v2" })` selects tool dispatch |
| OpenAI | 0.x, no deprecation markers | no `@deprecated` tag in `agents-core` |
| Pi | breaking changes inside 1.x | "Breaking Changes" in the patch releases 1.5.1 and 1.0.3 |

The table comes from [SDK research §1][sr1] and [§4][sr4]; the Pi patch releases are the corrected figures in [SDK fact-check row 25][sfc]. Vercel's pipeline is the one to copy, and Claude's capability list is how a separately versioned peer, such as a harness over RPC, learns what it can call ([SDK decision 13][sr6]).

**Silent behaviour changes break trust, so versioning must cover more than types.** About 60 HN authors object to defaults, prompts and visible output that change between releases without notice (view 11), and both sides of the degradation debate agree that users cannot tell a harness change from a model change ([HN §1][hn1]). Type-level semver does not cover that, so the HN synthesis extends SDK decision 13 to defaults, built-in prompts and tool descriptions ([HN §4.1][hn41]). The SDK should stamp its version and a hash of its defaults on `run_start`, so a harness can record them in the first log entry and a user can tell a version change from a model change ([HN §4.3, A11][hn43]).

**Docs drift wherever they build from a branch instead of a release.** Four references found the same failure:
- **Pi:** docs.pi.dev/latest serves main, and six pages described changes made after v1.5.2 ([Pi F1][pi-fc]).
- **LangChain:** the docs repo has no tags that match npm releases, and pages documented `modelRefusalMiddleware` before it shipped; 1.6.1 lacked it and 1.6.6 has it ([LangChain F3][lc-fc]).
- **Cloudflare:** two doc sites render branches, so pages import subpaths that 0.33.0 never exported; the `docs/` folder inside the npm package matches the release tag exactly ([Cloudflare F12–F15][cf-fc-drift]).
- **ADK:** the TypeScript prose lags the 2.5.0 package and calls `requireConfirmation` Python-only, though 2.5.0 has it ([ADK F2][adk-fc-doc]).

Cloudflare's npm folder shows the fix: ship the docs with the release they describe. Language tags need the same discipline. Python-first docs mislabel TypeScript support in both directions, so the deep comparison asks for support tags derived from each language's own types ([deep comparison][dc-docs]).

**Docs keep teaching deprecated and superseded APIs unless CI compiles them.** Cloudflare's approval docs build on `needsApproval`, which ai 7 deprecates, and a guardrail example uses AI SDK v3 provider types against a package that peers on v4 ([Cloudflare F9][cf-fc-doc]; [F16][cf-fc-dep]). Vercel's own examples read 6.x stream-part names ([Vercel F1][v-fc]). Across the eight references, the API tables were trustworthy almost everywhere and the errors sat in examples and in prose about defaults: 58 of 1,927 Cloudflare blocks and 78 of 713 LangChain blocks disagree with the pinned release ([deep comparison][dc-docs]). Compiled examples are the fix that works. OpenAI's `examples/docs` package runs `tsc --noEmit` over every embedded file through a `build-check` script, and none of OpenAI's 182 sources has an API error; none of Copilot's 68 blocks marked `docs-validate: strict` has one either ([OpenAI fact-check][oa-fc-t1]; [deep comparison][dc-docs]). Our CI copies that check and adds two diffs from our own Tier 3 method: fail on a new export missing from the docs, and fail on a documented name missing from the `.d.ts` ([hooks note, implication 7][n-hooks-impl]).

**Agents read our docs too, so the docs need a machine-readable form.** Practitioners report that models write against stale APIs and that feeding them current docs is the common fix ([HN §4.1][hn41]). The HN synthesis therefore adds an `llms.txt` and a compact docs index built from the same release tag as the npm package ([HN §4.1][hn41]).

## 11. Reference architecture

The SDK has six components. The gateway and the loop are the core; the tool runtime and hook bus are the loop's collaborators; the testing export and the docs pipeline ship beside them. Every component is removable, as [AGENTS.md](../../AGENTS.md) requires, so each can be ablated as models improve.

```text
                caller (app, harness, test)
                          │  run(options) / continue(context)
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Loop  (pure streaming function over a Context)                   │
│   transformContext → beforeModelCall → gateway.stream            │
│   → afterModelCall → tool pipeline → shouldStop                  │
│   stop reasons: done | max_steps | budget | no_progress |        │
│                 awaiting_approval | clarification_requested |    │
│                 aborted | error                                  │
├──────────────┬───────────────────────┬───────────────────────────┤
│ Hook bus     │ Tool runtime          │ Event stream (closed union)│
│ 6 interceptors│ resolve → coerce →   │ deltas keyed by index;     │
│ + observers  │ validate → repair →   │ *_end carries the item     │
│ (OTel        │ gate → execute →      │ the harness persists       │
│  observer)   │ afterToolCall         │                            │
└──────┬───────┴──────────┬────────────┴─────────────┬─────────────┘
       │                  │                          │
       ▼                  ▼                          ▼
┌──────────────────┐ ┌────────────────────┐  harness seams (G2):
│ Gateway          │ │ Tool definitions    │  session log, compaction
│ stream() v1      │ │ Standard Schema /   │  (via transformContext),
│ transformMessages│ │ JSON Schema; kinds; │  permission pipeline
│ retries, usage,  │ │ exposure; results   │  (via beforeToolCall),
│ cost, caching,   │ │ with 3 channels     │  MCP registry and tool
│ middleware       │ └────────────────────┘  search (via exposure)
└────────┬─────────┘
         ▼
 provider adapters (one per wire api)     testing export: ScriptedModel,
 base URL and transport overridable       autoResponder, mock transports,
                                          allowModelRequests(false)
```

The interfaces below are a starting sketch for P1, written in TypeScript. Each type follows the decision cited beside it; names and fields are for Round P to confirm.

```ts
// Gateway (§2; SDK decisions 1–5)
interface ModelAdapter {
  readonly specificationVersion: "v1";
  readonly api: string;       // wire protocol, e.g. "anthropic-messages"
  readonly provider: string;  // vendor and catalog entry
  stream(model: ModelRef, context: Context, options: StreamOptions): AsyncIterable<ModelEvent>;
}
type ModelEvent =
  | { type: "start" }
  | { type: "text_start" | "reasoning_start" | "tool_input_start"; index: number }
  | { type: "text_delta" | "reasoning_delta" | "tool_input_delta"; index: number; delta: string }
  | { type: "text_end" | "reasoning_end" | "tool_input_end"; index: number; block: ContentBlock }
  | { type: "done"; message: AssistantMessage }    // exactly one terminal event
  | { type: "error"; message: AssistantMessage };  // stopReason "error" | "aborted"

// Loop (§3; SDK decisions 6–8)
declare function run(options: RunOptions): Run;            // non-streaming callers await run.result
declare function continueRun(context: Context, options: RunOptions): Run;
interface Run extends AsyncIterable<AgentEvent> {
  result: Promise<RunResult>;
  steer(message: UserMessage): Promise<DeliveryReceipt>;
  followUp(message: UserMessage): Promise<DeliveryReceipt>;
  abort(reason?: string): void;
}
type RunResult =
  | { stopReason: "done"; messages: Message[]; usage: Usage; cost: Cost }
  | { stopReason: "max_steps" | "budget" | "no_progress" | "aborted" | "error"; messages: Message[]; usage: Usage; cost: Cost }
  | { stopReason: "awaiting_approval" | "clarification_requested"; pending: SignedPendingRequest[]; messages: Message[] };

// Tools (§4; SDK decisions 9–11)
interface ToolDefinition<I, S> {
  name: string;
  kind: "function" | "dynamic" | "provider-local" | "provider-executed";
  inputSchema: StandardSchemaV1<I> & StandardJSONSchemaV1 | JSONSchema;
  exposure?: "direct" | "deferred" | "hidden";
  executionMode?: "parallel" | "sequential";
  resourceKey?: (input: I) => string;               // per-resource serialisation
  execute(input: I, ctx: ToolContext): Promise<ToolResult<S>>;
}
interface ToolResult<S> { content: ModelContent[]; details?: unknown; structured?: S; isError?: boolean; terminate?: boolean }

// Hooks (§6; SDK decision 12)
interface Interceptors {
  transformContext?(e: ContextEvent): Promise<Message[]>;
  beforeModelCall?(e: ModelCallEvent): Promise<ModelCallPatch | void>;
  afterModelCall?(e: ModelResultEvent): Promise<{ message?: AssistantMessage } | void>;
  beforeToolCall?(e: ToolCallEvent): Promise<{ decision: "allow" | "deny" | "ask"; input?: unknown; reason?: string }>;
  afterToolCall?(e: ToolResultEvent): Promise<Partial<ToolResult<unknown>> | void>;
  shouldStop?(e: StepEvent): Promise<boolean | { continue: UserMessage }>;
}
// Every event carries runId, stepIndex, callId?, signal and a monotonic timestamp.

// Testing export (§8; SDK decision 14)
declare class ScriptedModel implements ModelAdapter { /* steps, calls (frozen), assertComplete() */ }
declare function allowModelRequests(allowed: boolean): void;
```

The components map onto the main report's layers. The gateway is layer 1, with the main report's "routing easy work to smaller models" narrowed to a per-subagent model setting (§2). The loop, hook bus and tool runtime are layer 2, and the event stream and resume primitive are the SDK's side of layer 3 ([main report][main-arch]). Layers 3 to 8 beyond those seams are G2's.

## 12. Open decisions for Round P

The research settles most of the design above; these twelve decisions remain for the implementation plan (P1). Each lists the options and the evidence that would settle it.

1. **Package split.** One package with subpath exports, or separate packages for the gateway, the loop and `testing`, as pi-ai and pi-agent-core are split ([SDK research §8][sr8]). Settle it with a dependency-graph sketch of our first harness and agent: if any consumer needs the gateway without the loop, split.
2. **First wire protocols.** Anthropic Messages, OpenAI Responses, OpenAI-compatible Completions, or a subset for v1; each needs a mock transport and a replay-transform test ([SDK research §8][sr8]). Settle it with the provider list for the G3 worked agent and its eval suite.
3. **Token field convention.** Whether the in-memory `input` field means uncached input, as Pi stores it, or the total, as Vercel's Anthropic adapter and OTel's `input_tokens` report it ([SDK research §8][sr8]; [harness research §7][har7]). Storing the four classes separately and summing them in the telemetry projection satisfies both; P1 must still name the field. Settle it by writing the OTel projection and the cost fold against both and choosing the one with fewer conversions.
4. **Cost catalog.** Where price tables come from, how often they refresh, and whether a provider-billed total overrides the catalog, as Pi's `totalFromProvider` does ([SDK research §8][sr8]). Settle it by checking which of the first providers return billed cost in their responses.
5. **Approval signing key.** Who owns the HMAC secret, how it rotates, and whether an unsigned resume fails closed by default; this merges with harness question 5 ([SDK research §8][sr8]; [harness research §9][har9]). Settle it with the harness's deployment model: a single process can generate a key per run, a multi-process host needs a shared key store.
6. **Hook names.** Our six moment-named interceptors or LangChain's names (`beforeModel`, `wrapToolCall`) for familiarity, and whether run-level hooks stay observers ([SDK research §8][sr8]). Settle it by porting the G3 triage capstone to both namings and counting the hooks each feature needs.
7. **Schema validator.** Which eval-free JSON Schema validator we bundle, and which drafts it supports, draft-07 or 2020-12 ([SDK research §8][sr8]). Settle it by running candidates against the schemas our first providers' strict modes accept, plus Claude's draft-07 output schemas ([feature table][ft-out]).
8. **Versioning start and CI checks.** 0.x with a changelog that still marks breaking changes, or 1.0 with full semver, and which CI check fails on exports missing from the docs ([SDK research §8][sr8]). Settle it by deciding whether any external consumer will depend on the SDK before the harness ships; if not, 0.x.
9. **Budget timing.** Whether the USD cap is checked before each model call, as harness decision 18 and the HN synthesis ask, or after the crossing response, as Claude and mini-swe-agent do ([harness research §9][har9]; [HN §4.1][hn41]). Settle it with a test that measures how far a post-response check overshoots on our longest recorded runs.
10. **Run outcomes as stop reasons or typed errors.** The research prefers stop reasons; the deep comparison prefers typed errors that a caller cannot ignore ([SDK decision 7][sr6]; [deep comparison][dc-sdk]). The proposal in §3 offers both through a narrowed union and a `runOrThrow()` helper. Settle it by writing the G3 capstone against both and checking which version lets an unhandled outcome compile.
11. **Progress-detection defaults.** What counts as a repeated identical failing call or a repeated edit, how many repeats fire `no_progress`, and the default subagent depth cap ([HN §4.1][hn41]). Settle it by replaying recorded runs, including the HN loop anecdotes' patterns, and tuning thresholds until none of the successful runs would have stopped.
12. **Tool-name sanitisation rule.** The 64-character, `[A-Za-z0-9_-]` floor in the tools note is an assumption without a per-provider table ([SDK research §7][sr7]; [tools note, implication 9][n-tools-impl]). Settle it by building that table from each first provider's API reference before the naming code is written.

The boundary question from the research, which pieces the harness owns, is already answered: G2a owns the session log format and the compaction layers and triggers, and the SDK defines the `transformContext` interceptor they run through ([harness research §7][har7]). P1 can therefore start with the gateway and the test model, the two components every other part depends on, and resolve these twelve decisions as each component reaches them.

[sr]: ../research/agent-sdk/agent-sdk-research.md
[sr1]: ../research/agent-sdk/agent-sdk-research.md#1-the-model-boundary-works-best-as-one-versioned-streaming-method-over-a-provider-neutral-transcript
[sr2]: ../research/agent-sdk/agent-sdk-research.md#2-the-loop-should-be-an-in-process-pure-function-whose-pauses-are-log-states
[sr3]: ../research/agent-sdk/agent-sdk-research.md#3-tools-should-accept-standard-schema-validate-in-the-sdk-and-return-every-failure-to-the-model
[sr4]: ../research/agent-sdk/agent-sdk-research.md#4-callers-need-six-typed-interceptors-a-layered-event-union-and-an-explicit-deprecation-pipeline
[sr5]: ../research/agent-sdk/agent-sdk-research.md#5-offline-testability-comes-from-a-strict-scripted-model-shipped-with-the-sdk
[sr6]: ../research/agent-sdk/agent-sdk-research.md#6-fourteen-design-decisions-follow-from-the-evidence
[sr7]: ../research/agent-sdk/agent-sdk-research.md#7-several-decisions-rest-on-unread-code-unreachable-sources-or-secondary-summaries
[sr8]: ../research/agent-sdk/agent-sdk-research.md#8-round-p-must-settle-nine-questions-before-code-starts
[sfc]: ../research/agent-sdk/fact-check.md
[sfc-r1]: ../research/agent-sdk/fact-check.md#re-verification-against-primary-sources-r1
[n-prov-3]: ../research/agent-sdk/notes/provider-abstraction.md#3-provider-specific-options-pass-through-namespaced-bags-and-payload-hooks
[n-loop-11]: ../research/agent-sdk/notes/loop-shapes.md#11-each-shape-trades-control-testability-and-safety-differently
[n-loop-impl]: ../research/agent-sdk/notes/loop-shapes.md#design-implications-for-our-sdk
[n-tools-4]: ../research/agent-sdk/notes/tools.md#4-repair-is-a-cheap-hook-before-the-error-turn-not-a-replacement-for-it
[n-tools-8]: ../research/agent-sdk/notes/tools.md#8-names-should-be-namespaced-by-source-and-sanitized-to-the-strictest-provider
[n-tools-9]: ../research/agent-sdk/notes/tools.md#9-deferred-loading-is-now-standard-in-three-forms
[n-tools-10]: ../research/agent-sdk/notes/tools.md#10-provider-defined-tools-need-their-own-type-kept-apart-from-function-tools
[n-tools-impl]: ../research/agent-sdk/notes/tools.md#design-implications-for-our-sdk
[n-hooks-4]: ../research/agent-sdk/notes/hooks-events-api.md#4-public-api-shape-functions-with-options-objects-win-classes-appear-where-state-lives
[n-hooks-5]: ../research/agent-sdk/notes/hooks-events-api.md#5-versioning-and-deprecation-four-strategies-one-clearly-best-documented
[n-hooks-6]: ../research/agent-sdk/notes/hooks-events-api.md#6-telemetry-otel-genai-spans-map-one-to-one-onto-the-hook-moments
[n-hooks-impl]: ../research/agent-sdk/notes/hooks-events-api.md#design-implications-for-our-sdk
[n-test-2]: ../research/agent-sdk/notes/testability.md#2-a-double-is-only-as-good-as-what-it-lets-you-assert
[n-test-6]: ../research/agent-sdk/notes/testability.md#6-recorded-fixtures-give-wire-fidelity-but-they-go-stale-and-can-leak-secrets
[n-test-impl]: ../research/agent-sdk/notes/testability.md#design-implications-for-our-sdk
[hn]: ../research/practitioners/practitioner-research.md
[hn1]: ../research/practitioners/practitioner-research.md#1-eleven-views-have-wide-support-led-by-quota-opacity-sandboxed-autonomy-and-plan-files
[hn22]: ../research/practitioners/practitioner-research.md#22-hn-confirms-ten-vendor-or-paper-claims-qualifies-three-and-contradicts-two-vendor-defaults
[hn41]: ../research/practitioners/practitioner-research.md#41-sdk-g1b
[hn42]: ../research/practitioners/practitioner-research.md#42-harness-g2b
[hn43]: ../research/practitioners/practitioner-research.md#43-agent-g3b
[main]: ../research/agent-sdks-and-harness-design.md
[main-arch]: ../research/agent-sdks-and-harness-design.md#a-reference-architecture-in-eight-swappable-layers
[main-evals]: ../research/agent-sdks-and-harness-design.md#observability-and-evals-close-the-loop
[fc]: ../research/fact-check-2026-11-18.md
[fc-review]: ../research/fact-check-2026-11-18.md#reference-architecture-review
[har3]: ../research/agent-harness/agent-harness-research.md#3-safety-is-three-separate-decisions-which-call-may-run-what-it-can-touch-and-which-secrets-it-sees
[har7]: ../research/agent-harness/agent-harness-research.md#7-the-evidence-revises-the-8-layer-architecture-in-six-places-and-creates-three-tensions-with-the-sdk-synthesis
[har9]: ../research/agent-harness/agent-harness-research.md#9-round-p-must-settle-nine-questions-before-harness-code-starts
[dc-same]: ../comparison/deep-comparison.md#1-the-same-agent-takes-58-to-115-lines-on-every-sdk-and-differs-in-its-gate
[dc-own]: ../comparison/deep-comparison.md#loop-ownership-decides-how-much-you-can-replace
[dc-safety]: ../comparison/deep-comparison.md#safety-defaults-range-from-six-permission-steps-to-none
[dc-reach]: ../comparison/deep-comparison.md#six-of-eight-sdks-have-a-default-that-reaches-outside-your-process
[dc-sdk]: ../comparison/deep-comparison.md#the-sdk-layer-one-model-interface-composable-stops-and-a-first-party-mock
[dc-harness]: ../comparison/deep-comparison.md#the-harness-layer-a-tree-log-an-explicit-gate-pipeline-and-resumable-approvals
[dc-agent]: ../comparison/deep-comparison.md#the-agent-layer-few-tools-a-gate-per-risk-and-a-final-tool-for-output
[dc-docs]: ../comparison/deep-comparison.md#4-the-docs-were-accurate-on-api-surfaces-and-least-accurate-in-examples-defaults-and-language-tags
[ft-loop]: ../comparison/feature-table.md#loop-control-default-caps-range-from-1-step-to-500-model-calls
[ft-out]: ../comparison/feature-table.md#output-structured-output-everywhere-though-adk-only-logs-a-schema-violation
[pi-fc]: ../reference/pi/fact-check.md#six-findings-one-site-issue-two-home-folder-and-credential-defaults-and-three-doc-gaps
[lc-fc]: ../reference/langchain/fact-check.md#eight-findings-seven-doc-errors-and-one-testing-gap
[v-fc]: ../reference/vercel-ai-sdk/fact-check.md#eight-findings-seven-doc-errors-one-gap-in-the-tables
[oa-fc-t1]: ../reference/openai-agents-sdk/fact-check.md#tier-1-178-of-182-sources-compile-and-none-has-an-api-error
[cp-fc-err]: ../reference/copilot-sdk/fact-check.md#doc-errors-code-or-claims-that-dont-match-the-release
[cp-fc-types]: ../reference/copilot-sdk/fact-check.md#types-that-disagree-with-the-docs-or-the-runtime
[cp-fc-def]: ../reference/copilot-sdk/fact-check.md#defaults-that-matter-for-an-embedding
[cp-g1]: ../reference/copilot-sdk/guide.md#1-the-sdk-drives-the-copilot-runtime-over-json-rpc-and-the-runtime-owns-the-loop
[cp-g11]: ../reference/copilot-sdk/guide.md#11-tests-run-the-real-runtime-offline-against-a-byok-mock-inside-a-network-namespace
[adk-fc-doc]: ../reference/google-adk/fact-check.md#doc-errors
[adk-fc-sdk]: ../reference/google-adk/fact-check.md#sdk-behavior
[adk-g10]: ../reference/google-adk/guide.md#10-offline-tests-need-a-basellm-subclass-because-adk-ships-no-fake-model
[cf-fc-sdk]: ../reference/cloudflare-agents/fact-check.md#sdk-behavior-and-types
[cf-fc-drift]: ../reference/cloudflare-agents/fact-check.md#docs-that-drift-from-the-release
[cf-fc-doc]: ../reference/cloudflare-agents/fact-check.md#doc-errors-code-that-does-not-work-as-written
[cf-fc-dep]: ../reference/cloudflare-agents/fact-check.md#deprecations-the-docs-still-teach
[cf-g12]: ../reference/cloudflare-agents/guide.md#12-tests-run-in-workerd-with-a-mock-model
