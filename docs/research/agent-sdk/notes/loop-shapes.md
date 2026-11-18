# Agent loop shapes: in-process, subprocess and durable

Research note for the agent-speak SDK, written November 2026. The question is what shapes the agent loop takes in mature SDKs, how each step is structured, and what each shape costs in control, testability and safety. Every claim cites a file and line range in the installed packages or a URL. Versions are as of November 2026: `@earendil-works/pi-agent-core` and `pi-coding-agent` 1.5.2, `ai` 7.0.162, `@openai/agents-core` 0.21.0, and `@anthropic-ai/claude-agent-sdk` 0.3.327. The contrast clones are mini-swe-agent at commit `04d809ce` and openai/codex at commit `4389a526` (2026-11-18). Paths starting `pi/`, `ai/`, `oai/` and `claude/` are relative to each package's directory under `verify/<sdk>/node_modules/`. Paths starting `mini/` and `codex/` are relative to the scratchpad clones.

Summary: every SDK runs the same four-beat step, but they disagree on five things: who owns the loop, the default turn cap, what a pause is, where steering lands, and whether streaming shares code with the non-streaming path. Those five choices determine control, testability and safety more than any API surface does.

## 1. Three shapes exist, and they differ in who owns the loop state

| Shape | Examples | Loop state lives in | Pause is | Crash loses |
|---|---|---|---|---|
| In-process function | Vercel `generateText`/`streamText`/`ToolLoopAgent`; Pi `agentLoop`; OpenAI `run()` | JS heap for one call | the function returning (Vercel, OpenAI) or the loop simply not starting another turn (Pi) | the current turn, unless the host persisted events |
| Subprocess | Claude Agent SDK; Codex TS SDK | a separate CLI process | a pending stdio control request | the CLI process (the transcript on disk survives) |
| Durable workflow | Vercel `WorkflowAgent`; Temporal/DBOS adapters; Anthropic Managed Agents | an external event history or session log | a suspended workflow or a log with no next event | nothing that was committed as a step or event |

- **In-process.** Pi's `agentLoop` is a pure function over `(prompts, context, config, signal, streamFn)` that returns an event stream (`pi/pi-agent-core/dist/agent-loop.js:16-24`). The stateful `Agent` class wraps it, owns the transcript and the queues, and rejects a second `prompt()` while a run is active (`pi/pi-agent-core/dist/agent.js:246-252`). Vercel's loop is a `do { … } while (await shouldStartNextStep())` inside `generateTextInternal` (`ai/dist/index.js:5389-5440`). OpenAI's loop is `Runner.#runIndividualNonStream` (`oai/agents-core/dist/run.js:540`), and a `RunState` object carries its state.
- **Subprocess.** `query()` spawns the CLI with `--output-format stream-json --verbose --input-format stream-json` (`claude/claude-agent-sdk/sdk.mjs:164`, minified). The CLI owns the loop, the tools and the transcript (`docs/reference/claude-agent-sdk/guide.md:9`). Codex's TypeScript SDK uses the same pattern: it spawns the CLI and exchanges JSONL over stdio (`docs/research/harness-architectures.md:44`).
- **Durable.** `WorkflowAgent` "provides the same agent loop as the `ToolLoopAgent`" but runs it inside a workflow where "each tool execution is a durable step with automatic retries" (`docs/reference/vercel-ai-sdk/source/content/docs/03-agents/07-workflow-agent.mdx:8,19`). Managed Agents puts the loop in a stateless harness over an external session log (https://www.anthropic.com/engineering/managed-agents).

The minimal baseline confirms the core is small. mini-swe-agent's whole control flow is `while True: step()`, where `step = execute_actions(query())`. Limits are checked before each model call, and the loop exits when the last message has role `exit` (`mini/src/minisweagent/agents/default.py:88-157`). Anthropic describes agents as "typically just LLMs using tools based on environmental feedback in a loop" and recommends "stopping conditions (such as a maximum number of iterations) to maintain control" (https://www.anthropic.com/engineering/building-effective-agents).

## 2. Every step has the same anatomy, but the hook points differ

The canonical step has six parts: prepare, call the model, parse tool calls, gate each call, execute, append the results, then check whether to stop.

| Phase | Pi | Vercel AI SDK | OpenAI Agents | Claude Agent SDK |
|---|---|---|---|---|
| Pre-step | `prepareNextTurn` (can swap context or model; may compact), then `prepareRequest`, `transformContext`, `convertToLlm` (`agent-loop.js:97-144,265-273`) | `prepareStep` can override model, tools, toolChoice, messages and instructions per step (`index.js:5432-5503`) | `prepareTurn`: increments the turn, checks maxTurns and starts input guardrails (`runner/turnPreparation.js:56-80`) | CLI-internal; the SDK sees only hooks such as `UserPromptSubmit` (`claude/sdk.d.ts:1032`) |
| Model call | `streamAssistantResponse`, always streamed (`agent-loop.js:265-340`) | `doGenerate` or `doStream` | `model.getResponse` or `getStreamedResponse` | CLI |
| Per-call gate | arg prep, schema validation, `beforeToolCall` (block, with optional terminate) (`agent-loop.js:487-546`) | `resolveToolApproval`: user-approval, approved or denied (`index.js:5647-5710`) | parse, then `needsApproval`, then tool input guardrails (`runner/toolExecution.js:296-300,715-731`) | `PreToolUse` hook, then permission rules, then the `canUseTool` callback over stdio (`claude/sdk.d.ts:244`; `sdk.mjs:167`) |
| Execute | parallel by default; sequential if any tool in the batch says so (`agent-loop.js:372-379`) | `mapWithConcurrency`, unlimited by default (`index.js:5089-5108`) | `executeToolRunsWithConcurrency`, unlimited by default, with sibling cancellation (`runner/toolExecution.js:375-387`) | read-only tools run concurrently, the rest sequentially (`docs/reference/claude-agent-sdk/source/agent-loop.md:184-186`) |
| Post-call | `afterToolCall` may rewrite content, isError or terminate (`agent-loop.js:604-645`) | `onToolExecutionEnd` (observe only) | tool output guardrails | `PostToolUse` / `PostToolUseFailure` / `PostToolBatch` hooks (`claude/sdk.d.ts:1032`) |
| Stop check | `finishTurn` returns end or continue; the loop continues while tool calls or steering exist (`agent-loop.js:178-195`) | `shouldStartNextStep`, then `isStopConditionMet` (`index.js:5389-5410`) | `next_step_{run_again,final_output,handoff,interruption}` (`run.js:1171-1200`) | CLI; result `subtype` (`claude/sdk.d.ts:6227`) |

Pi has the richest in-process hook set, because a hook can end the run (`finishTurn` returning `end`) or force one more context-only turn (`continue`, `agent-loop.js:186-208`). Vercel's `prepareStep` is the strongest per-step override. OpenAI keeps the loop closed and exposes policy objects (`toolUseBehavior`, guardrails, `errorHandlers`) instead of hooks.

## 3. Default caps diverge, from none to one step

| Loop | Default cap | What happens at the cap |
|---|---|---|
| Vercel `generateText` / `streamText` | `stopWhen = isStepCount(1)` (`ai/dist/index.js:5199,8822`) | stops after one model call; tools run, but the model never sees their results |
| Vercel `ToolLoopAgent` | `createDefaultStopCondition(20)`, which logs a warning when hit (`index.js:10611-10626,10675`) | returns normally |
| Vercel `WorkflowAgent` | `stream()` unbounded; `generate()` 20 (`07-workflow-agent.mdx:402-435,805`) | returns normally |
| OpenAI `run()` | `DEFAULT_MAX_TURNS = 10` (`oai/dist/runner/constants.js:5`) | throws `MaxTurnsExceededError` (`runner/turnPreparation.js:63-68`) unless `errorHandlers.maxTurns` converts it (`runner/errorHandlers.js:85-93`) |
| Claude Agent SDK | none documented: "Without limits, the loop runs until Claude finishes" (`agent-loop.md:48`); `maxTurns` and `maxBudgetUsd` are optional (`claude/sdk.d.ts:2062-2070`) | `error_max_turns` or `error_max_budget_usd` result (`sdk.d.ts:6227`) |
| Pi | no turn cap in `agent-loop.js` or `agent-session.js` (grep for `maxTurns` finds nothing) | n/a; the host must stop the loop via `finishTurn`, a `terminate` result or `abort()` |
| mini-swe-agent | `step_limit = 0` (unlimited), `cost_limit = 3.0` USD (`default.py:26-31`) | appends an `exit` message, `LimitsExceeded` |

Two details matter for our design:
- **Turn accounting.** OpenAI counts a turn when a model call starts, and resolving approvals does not consume one (`runner/turnPreparation.js:166-178`). Claude counts the final text-only answer as a turn, so `maxTurns` must leave room for it (`agent-loop.md:46`). In Vercel, a step is one model call (`isStepCount`, `index.js:4643-4645`).
- **Natural termination is not a stop condition.** Vercel evaluates `stopWhen` only when the loop could otherwise continue (`index.js:10607-10610` comment; `5391-5409`). Vercel and Pi both end on a model message without tool calls; OpenAI ends when the output type is satisfied (the `next_step_final_output` path in `runner/turnResolution.js:1095-1099`).

## 4. Tool errors go back to the model as data, with three exceptions

The common rule is: catch the error and return it as an error tool result.
- **Pi** never rejects for tool failures. Unknown tools, validation errors, blocked calls and thrown errors all become `isError: true` results (`agent-loop.js:487-546,574-603`; contract stated at `556-564`).
- **Vercel** turns a thrown `execute` into a `tool-error` output (`index.js:2861-2950`), and invalid dynamic tool calls become `tool-error` (`index.js:5711-5720`).
- **OpenAI** returns `defaultToolErrorFunction` ("An error occurred while running the tool. Please try again.") to the model (`oai/dist/tool.js:572-574`).

The three exceptions:
1. **OpenAI tools with `outputSchema`** get `errorFunction = null`, so the error raises instead (`tool.js:756-760`).
2. **Truncated (`length`) responses.** Pi fails every tool call in the message with a "re-issue" error and continues (`agent-loop.js:164-170,348-368`). Vercel does not execute tools unless the finish reason is `stop` or `tool-calls` (`index.js:3102-3104,5725`); the step then has calls without outputs, so the loop ends with `waiting-for-tool-results` (`index.js:5391-5394`). Pi's approach recovers on its own, while Vercel's surfaces the truncation to the caller.
3. **Model and provider errors are thrown or returned as a stop reason, never fed back as text.** Pi ends the run on `stopReason: error|aborted` (`agent-loop.js:148-159`), then `AgentSession` retries outside the loop: three retries with a 2000 ms base backoff (`pi/pi-coding-agent/dist/core/settings-defaults.js:19-20`; `agent-session.js:3189-3233`). Context overflow is excluded from retry and handled by one compact-and-retry (`agent-session.js:3139-3147,2510-2565`). Vercel retries API calls with `maxRetries = 2` and a 2 s initial delay (`index.js:2325`), and `streamRetries` defaults to 0 (`index.js:8758`).

## 5. Pausing for approval takes three forms, and only two survive a restart

| Model | SDK | Mechanism | Survives process death? |
|---|---|---|---|
| **Serializable state object** | OpenAI | `next_step_interruption` stops the loop, and the result carries `interruptions`. `state.approve()` / `reject()` (`runState.js:2295-2318`), then `toString()` / `fromString()` (`runState.js:2518-2535`), and `run(agent, state)` resumes (`run.js:545-556`) | yes, if the host stores the string |
| **Messages as state** | Vercel | blocked calls leave `clientToolCalls` without outputs, so the loop stops (`index.js:5391-5394,5666-5674`). To resume, the caller appends a `tool-approval-response` to `messages` and calls again; `collectToolApprovals` executes approved calls before the first model step (`index.js:5300-5384`). Optional HMAC signing (`experimental_toolApprovalSecret`, `index.js:5656-5662`) stops a forged history from approving a call | yes; the history is the state |
| **Blocking callback** | Claude, Pi | The CLI sends a `can_use_tool` control request and waits on the host's `canUseTool` promise (`sdk.mjs:167`). A `control_cancel_request` aborts that promise (`sdk.mjs:167`, `handleControlCancelRequest`). In Pi, `beforeToolCall` is awaited inline (`agent-loop.js:499-524`) | no; a restarted CLI can re-announce pending prompts via `pending_permission_requests` on `initialize` (`claude/sdk.d.ts:435`), but the turn is held in memory |
| **Durable suspension** | `WorkflowAgent` | `needsApproval` suspends the workflow: "the user can approve hours later and the agent will resume" (`07-workflow-agent.mdx:321-355`) | yes, by design |

The blocking-callback form is the simplest to write and to test (a promise), but it ties approval latency to process lifetime. The message and state-object forms make approval asynchronous, and they create a replay-trust problem. Vercel answers that problem with signatures. OpenAI re-checks the tool identity and MCP binding on resume (`runner/toolExecution.js:214-233`).

## 6. Interrupt, abort and steer have different granularity, and each has a race

- **Abort (in-process).** Pi checks the signal between preparation and execution and after each sequential call. Calls not yet started become "Operation aborted" errors (`agent-loop.js:408-410,435-449,506-531`). In parallel mode the dispatch loop `break`s on abort (`agent-loop.js:455-457`), so some tool calls may get no result message at all; I did not verify whether `normalizeContext` repairs those orphaned calls on the next request (`agent-loop.js:273`). Vercel calls `throwIfAborted()` at each step start (`index.js:5413`) and inside the concurrency workers (`index.js:5096`), so abort rejects the whole call and steering ends as `aborted` (`index.js:5917`). OpenAI turns aborted tool runs into cancellation outputs (`runner/toolExecution.js:211-213,301-313`) and unanswered handoffs into abort results (`runner/turnResolution.js:1112-1119`).
- **Abort (session layer).** Pi's `AgentSession.abort()` cancels the retry sleep, compaction and branch summary, then aborts the agent and awaits `waitForIdle()` (`agent-session.js:2073-2090`). Idle comes only after `agent_settled`, which fires once retries and deferred actions are done (`agent-session.js:737-760`). This is the clean answer to "when is it safe to send the next prompt".
- **Interrupt (subprocess).** `interrupt()` returns a receipt whose `still_queued` lists async user messages that will still run (`claude/sdk.d.ts:3171-3178,5064-5070`). An opt-in flag also cancels those messages, and the docs describe a fold-in-flight window where a dequeued message can still appear in the aborted turn's transcript (`sdk.d.ts:5053`). The receipt exists because interrupt-versus-queue is a real race across a process boundary.
- **Steer.** Pi polls `getSteeringMessages` at loop start, after `prepareNextTurn`, and after each turn's tools finish (`agent-loop.js:90,115-117,191`). Steering therefore never cuts off a running tool batch. `getFollowUpMessages` runs only when the loop would otherwise stop (`agent-loop.js:197-203`), and both queues default to `one-at-a-time` (`agent.js:60-82,141-142`). Vercel's `experimental_steering` has the same split (`steer` adds to `pending` and is taken at the next step boundary, while `queue` is promoted only when the loop would stop) and adds a **delivery receipt**: each message resolves as `delivered` with a `stepNumber`, or `not-delivered` with a reason such as `removed-by-prepare-step`, `finished` or `aborted` (`index.js:4488-4597,5389-5421`). Claude user messages carry `priority: 'now' | 'next' | 'later'` (`claude/sdk.d.ts:6951`). Codex drains pending input at each sampling iteration, accepting it only when the session's work budget allows (`codex/codex-rs/core/src/session/turn.rs:555-570,722-737`).
- **Race to design for.** Steering that arrives while a turn is finishing can land in this turn or the next. Pi avoids a double delivery by polling again only if the previous poll was empty (`agent-loop.js:112-117`). Vercel truncation does not consume promoted queue messages (`index.js:5396-5397`).

## 7. Streaming parity is free only when one loop serves both modes

- **Pi** has one loop and always streams. The non-streaming API is just the final `agent_end` messages (`agent-loop.js:78-80`). Parity is total.
- **Vercel** has two loop implementations (`generateTextInternal` at `index.js:5199` and `streamTextInternal` / `DefaultStreamTextResult` at `8822,9088`) with duplicated `shouldStartNextStep` logic (`5389-5410` versus `10243-10264`). In streaming, tool calls are collected as they arrive but executed only at `model-call-end`, behind the same finish-reason gate (`index.js:7826-7935`), so the semantics match. Timeouts differ: `firstChunkMs` and `chunkMs` exist only for streaming (`index.js:5219-5228`).
- **OpenAI** keeps separate `#runIndividualNonStream` and `#runStreamLoop` paths (`run.js:540,1293`), a parity risk by construction.
- **WorkflowAgent** documents a parity gap: `generate()` caps at 20 steps while `stream()` is unbounded (`07-workflow-agent.mdx:805`).
- **Codex** goes the other way. Each tool future starts as soon as its `OutputItemDone` arrives mid-stream (`turn.rs:3319,3442-3456`), and futures are drained in order after the stream ends (`turn.rs:3924`). Parallel-safe tools take a read lock and the rest take a write lock, which serializes mutators without a concurrency number (`codex/codex-rs/core/src/tools/parallel.rs:330-340`).

## 8. Concurrency is unlimited by default; safety comes from per-tool classes

Pi lets a tool force `executionMode: "sequential"` for the whole batch (`agent-loop.js:374-378`). OpenAI runs function and computer tools in parallel but keeps shell and apply_patch in model order, because "both mutate the sandbox filesystem" (`runner/turnResolution.js:903-915`). Claude parallelizes only `readOnlyHint` tools (`agent-loop.md:184-186`), and Codex uses its RwLock gate. Vercel offers only a numeric `toolCallConcurrency`, unlimited by default (`index.js:5069-5081,5089-5090`). In every SDK, results are appended in model order: Pi orders them with `Promise.all` over its ordered entries (`agent-loop.js:459-465`), Vercel writes results by index (`index.js:5091-5100`), and Codex drains a `FuturesOrdered`.

## 9. Guardrails in parallel with the model call save latency, not side effects

OpenAI input guardrails run in parallel unless `runInParallel === false` (`runner/guardrails.js:165-175`; `runner/turnPreparation.js:150-160`). The runner awaits `guardrailTracker.awaitCompletion()` before resolving the turn, so no tool executes before a tripwire can fire (`run.js:1135-1138`; also `run.js:1088`). The price of a tripwire is wasted model tokens, not unwanted actions. Guardrails run only on turn 1 or on newly pending input (`runner/turnPreparation.js:134-139`).

## 10. A stateless loop over an event log moves durability out of the loop

- **Managed Agents.** The session is "the append-only log of everything that happened". The harness runs outside the container, calls tools through `execute(name, input) → string`, and writes events with `emitEvent`. On a crash, `wake(sessionId)` and `getSession(id)` resume from the last event, and a container failure becomes a tool-call error the model can retry. Tokens are "never reachable from the sandbox", and the post reports p50 TTFT down about 60% and p95 down over 90% (https://www.anthropic.com/engineering/managed-agents).
- **Pi is halfway there.** The loop function is stateless over `context`, and `AgentSession` persists every `message_end` to an append-only tree session (`agent-session.js:818-830`). A failed attempt stays in raw history but is "durably omit[ted] from model projection" (`agent-session.js:3211-3212`). `agentLoopContinue` resumes from any context whose last message is a user or tool result (`agent-loop.js:33-47`), which is exactly the `wake` contract.
- **Workflow engines** replay completed steps. "completed-step replay does not guarantee exactly-once effects for an interrupted attempt" (`07-workflow-agent.mdx:842`), and a model deadline does not cancel a tool waiting on a hook (`07-workflow-agent.mdx:838-840`). Temporal's integrations map model and tool calls to activities and keep workflow code deterministic (secondary: `docs/research/notes/custom-harness-architecture.md:167`; Pydantic AI's `TemporalDurability` in `docs/research/notes/oss-frameworks.md:78`). docs.temporal.io was unreachable from this session, so I did not check these against primary docs.
- **Stateful agents** (OpenAI `RunState`, the Claude CLI process) carry hidden fields that must round-trip. `RunState` has a versioned schema with migrations, for example "1.11: Allows null maxTurns" (`runState.js:110`), plus persisted-item offsets per turn (`run.js:1-120`). That is the cost of serializing a live loop instead of deriving it from a log.

## 11. Each shape trades control, testability and safety differently

| | In-process | Subprocess | Durable |
|---|---|---|---|
| Control | full: hooks at every phase (Pi), per-step overrides (Vercel) | options, hooks and control requests only; the loop, tools and compaction are fixed by the CLI (`guide.md:5-21`) | full, but code must respect determinism and step boundaries |
| Testability | best: Pi's `fauxProvider`, Vercel's `MockLanguageModelV4`, OpenAI's `ScriptedModel`, all offline | needs a mock Messages API behind `ANTHROPIC_BASE_URL`, plus tool-search emulation (`guide.md:120-121`) | needs the workflow runtime or its test harness; replay adds a test dimension |
| Safety | in the host's own process, so tool sandboxing is the host's job; approvals block in memory | process isolation from the host and a mature permission chain, but each session costs a CLI process (about 1 GiB RAM, `guide.md:21`) | approvals survive restarts; side effects need idempotency keys (`07-workflow-agent.mdx:842`) |
| Crash | lose the turn | lose the process; the transcript survives | lose nothing committed |

## Design implications for our SDK

1. **Write the loop once, as a pure streaming function over a context, and derive everything else from its events.** Pi proves one streamed loop gives exact parity (§7). Vercel and OpenAI show the duplication cost of two loops (`index.js:5389` versus `10243`; `run.js:540` versus `1293`). The non-streaming API should only collect the stream.
2. **Make the session event log the source of truth, and make `continue(context)` the resume primitive.** Pi's `agentLoopContinue` precondition (the last message is a user or tool result, `agent-loop.js:33-39`) plus an append-only log equals Managed Agents' `wake`/`getSession` (§10). Durable engines then become an adapter: each model call and each tool call is one activity, not a second loop.
3. **Represent a pause as a log state, not a blocked promise.** End the run with an `awaiting_approval` stop reason when a gate returns `ask`, persist the pending call, and resume by appending the decision event (the Vercel message model, §5). Sign approval events, because replayed histories are untrusted (`index.js:5656-5662`). Keep an in-memory blocking gate as a convenience on top for CLIs and tests.
4. **Ship a non-zero default cap and a cost cap, and return a stop reason instead of throwing.** Defaults range from 1 (a footgun) to unbounded (§3). Take 20 steps from `ToolLoopAgent`, add a USD cap like mini-swe-agent's `cost_limit`, and return `{stopReason: "max_steps"}` the way Claude's result subtypes do. Do not throw the way OpenAI does. Count a step as one model call, do not charge approval resolution as a step (OpenAI, `turnPreparation.js:166-178`), and warn when the cap fires (`index.js:10611-10626`).
5. **Never throw for tool failures; do fail truncated tool calls.** Adopt Pi's contract (`agent-loop.js:556-564`): unknown tools, invalid arguments, blocked calls, exceptions and aborts all become error tool results. On a `length` stop, return "re-issue" errors rather than executing salvaged JSON (`agent-loop.js:341-368`). Keep provider errors as stop reasons, and put retry and overflow compaction in a separate layer around the loop (Pi `AgentSession`, §4), so the loop stays testable.
6. **Set concurrency by tool class, not by number.** Default to parallel for tools marked read-only and serialize mutators with a read-write gate (Codex `parallel.rs:330-340`; Claude `readOnlyHint`). Always append results in model order. Offer a numeric limit as a secondary knob.
7. **Steer only at turn boundaries, with two queues and delivery receipts.** Use Pi's steer and follow-up semantics (§6) plus Vercel's `delivered`/`not-delivered(reason)` outcomes (`index.js:4554-4597`), so that UIs and tests can assert where a message landed. Never cut a running tool batch on steer; that is what abort is for.
8. **Define abort to always produce a well-formed transcript, and settle explicitly.** Every tool call must get a result (an aborted error if needed), the open assistant message must close with `stopReason: aborted`, and an `agent_settled` event should fire only after retries and compaction have stopped (`agent-session.js:737-760,2073-2090`). Add a test that aborts mid parallel batch, because Pi's parallel `break` path is the gap to avoid (§6).
9. **Run parallel input guardrails, but gate tool execution on their completion.** That keeps OpenAI's latency win without side-effect risk (`run.js:1135`).
10. **Treat the subprocess shape as a deployment option, not the core.** It buys isolation and a mature tool chain, at the cost of a closed loop, a heavy test setup and one process per session (§11). If we offer it, expose a control protocol with request IDs, cancel requests and interrupt receipts, as Claude's does (`sdk.mjs:167`; `sdk.d.ts:3171-3178`).

## Gaps

- I did not verify whether Pi's `normalizeContext` repairs tool calls left without results after a parallel-batch abort.
- I did not read the Claude CLI's internal loop (it ships compiled); its concurrency and turn semantics come from docs only.
- Temporal and DBOS claims are secondary; docs.temporal.io must be allowed in the session's network settings before they can be checked.
- I read OpenAI's streaming loop (`run.js:1293-2145`) only at the entry point, so I have not confirmed its divergences from the non-streaming path.
- I read Codex's turn loop only for tool dispatch and pending input; its retry and compaction paths are unread.
