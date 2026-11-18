# Hooks, events and public API: what callers need and how mature SDKs evolve it

Status: research note, 2026-11-18. Working material for the agent-SDK design; the main report supersedes it where they disagree.

**Thesis.** All four SDKs split extension into two channels: *observers* that cannot change the run (lifecycle callbacks, event streams, tracing processors) and
*interceptors* that return a decision or a replacement value (tool gates, context transforms, model middleware). The SDKs differ in how cleanly they separate
the two. Vercel and OpenAI keep observers fire-and-forget and give interceptors distinct names. Pi and Claude route both through one `on(event)` or `hooks`
registry and let the result type say which is which. Event streams converge on a typed discriminated union with `*_start` / `*_delta` / `*_end` triples keyed
by id, plus a coarser "item" layer for UIs. Versioning is where the SDKs differ most. Vercel runs an explicit `experimental_` → stable → removed pipeline with
`@deprecated` aliases and spec-versioned model adapters (V2/V3/V4). Claude negotiates capabilities at runtime. OpenAI (0.x) and Pi (1.x) ship breaking changes
in minor and patch releases.

Versions as of November 2026: `ai` 7.0.162 with `@ai-sdk/provider` 4.0.35 and `@ai-sdk/otel` 1.0.162; `@earendil-works/pi-agent-core` and `pi-coding-agent`
1.5.2; `@openai/agents-core` 0.21.0; `@anthropic-ai/claude-agent-sdk` 0.3.327 (each package's `package.json`).

Path abbreviations:
- `V` = `verify/vercel-ai-sdk/node_modules/ai/dist/index.d.ts`; `VS` = `verify/vercel-ai-sdk/node_modules/ai/src/`; `VCL` =
  `verify/vercel-ai-sdk/node_modules/ai/CHANGELOG.md`; `VP` = `verify/vercel-ai-sdk/node_modules/@ai-sdk/provider/dist/index.d.ts`; `VDOC` =
  `docs/reference/vercel-ai-sdk/source/content/docs/03-ai-sdk-core/`
- `PC` = `verify/pi/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts`; `PX` = `verify/pi/node_modules/@earendil-works/pi-coding-agent/dist/`; `PCL` =
  `verify/pi/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md`
- `O` = `verify/openai-agents-sdk/node_modules/@openai/agents-core/dist/`
- `C` = `verify/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`

## 1. Hook points: every SDK covers the same six moments, but only some can intervene

### 1.1 Taxonomy across the four SDKs

| Moment | Vercel AI SDK 7 | Pi 1.5.2 (core / extension) | OpenAI Agents 0.21 | Claude Agent SDK 0.3 |
|---|---|---|---|---|
| Run start/end | `onStart`, `onEnd`, `onAbort`, `onError` — observe (V:4115-4152) | `agent_start`/`agent_end` events (PC:461-465); ext `before_agent_start` **rewrites** system prompt (PX core/extensions/types.d.ts:1145-1149) | `agent_start`/`agent_end` — observe (O lifecycle.d.ts:75-98) | `SessionStart`, `SessionEnd`, `Stop` (Stop can **block/continue**; C:10467-10471) |
| Before model call | `prepareStep` **rewrites** model, tools, toolChoice, messages (V:4037, V:3238-3241); middleware `transformParams` (VP:3536-3540); `onLanguageModelCallStart` observe (V:4168) | `transformContext` **rewrites** messages (PC:188-207); `prepareRequest` **replaces** context/model/thinking (PC:231); ext `context`, `context_with_system`, `before_provider_request` **rewrite** (PX core/extensions/types.d.ts:1242-1245, 1102-1107) | `callModelInputFilter` **rewrites** instructions + input (O run.d.ts:161-165; O runner/conversation.d.ts:8-17) | none per model call; `UserPromptSubmit` (per prompt), `PreCompact`, `PreModelSwitch` (C:1032) |
| After model call | `onLanguageModelCallEnd` observe (V:4179); middleware `wrapGenerate`/`wrapStream` **rewrite** results (VP:3551-3573) | ext `after_provider_response`, `provider_stream_event` observe; `message_end` **replaces** finalized message (PX core/extensions/types.d.ts:1141-1144) | none (stream events only) | none (stream messages only) |
| Before tool call | `toolApproval` **gates**, `repairToolCall` and `experimental_refineToolInput` **rewrite** input, `onToolExecutionStart` observe (V:4015, 4041, 4054, 4190) | `beforeToolCall` → `{block, reason, terminate}` (PC:44-52, 279); ext `tool_call` **blocks**, mutates `event.input` in place to rewrite (PX core/extensions/types.d.ts:1109-1117) | `agent_tool_start` observe (O lifecycle.d.ts:110); tool input guardrails `allow`/`rejectContent`/`throwException` (O toolGuardrail.d.ts:13-36); `needsApproval` (O tool.d.ts:32) | `PreToolUse` → `permissionDecision` allow/deny/ask, `updatedInput`, `additionalContext` (C:2960-2965); `canUseTool` → `PermissionResult` (C:244, C:2719-2731) |
| After tool call | `onToolExecutionEnd` observe (V:4200) | `afterToolCall` → field-wise replace `content`/`details`/`isError`/`terminate` (PC:54-80, 293); ext `tool_result` (PX core/extensions/types.d.ts:1134-1140) | `agent_tool_end` observe (O lifecycle.d.ts:124-132); tool output guardrails; `toolErrorFormatter` rewrites error text (O run.d.ts:166-170) | `PostToolUse` → `updatedToolOutput`, `additionalContext` (C:2882-2896); `PostToolUseFailure`, `PostToolBatch` |
| Between steps / stop | `stopWhen` conditions (V:3954); `onStepStart`/`onStepEnd`/`onStepError` observe (V:4129-4157) | `finishTurn`, `prepareNextTurn` (PC:225, 237); ext `turn_end`, `agent_before_settle` return `BoundaryResult` (PX core/extensions/types.d.ts:1105-1106) | `maxTurns`, `errorHandlers` keyed by `maxTurns`/`modelRefusal`/`invalidFinalOutput` (O run.d.ts:186-205; O runner/errorHandlers.d.ts:12) | `Stop`/`SubagentStop` `additionalContext` makes the loop continue (C:10467-10512) |
| Steering queue | `experimental_steering` / `experimental_createSteering` (V:3980, 3341, 3419) | `getSteeringMessages`, `getFollowUpMessages` (PC:249-261); RPC `steer`, `follow_up` | none found in `agents-core` d.ts | `Query.streamInput()` (C:3568); `interrupt()` (C:3179) |
| Compaction | none | ext `session_before_compact` → `{cancel, compaction}` (PX core/extensions/types.d.ts:1157-1160) | `compaction_item_created` item event (O events.d.ts:23) | `PreCompact`, `PostCompact` (C:1032) |

### 1.2 Counts show two scales of surface

- **Vercel** exposes 8 stable lifecycle callbacks per text call (`onStart`, `onStepStart`, `onLanguageModelCallStart/End`, `onToolExecutionStart/End`,
  `onStepEnd`, `onEnd`) plus `onStepError`, `onAbort`, `onChunk` and `onError` (V:3912-3928, V:4080-4206). The docs give the order as start → stepStart →
  modelCallStart → modelCallEnd → toolExecStart → toolExecEnd → stepEnd → … → end (VDOC 65-lifecycle-callbacks.mdx:277-300).
- **Pi** core has 10 `AgentEvent` variants (PC:461-503) and about 8 hook functions on the loop config (PC:186-293). The coding-agent extension API registers
  **41** events (PX core/extensions/types.d.ts:1229-1269). By our count, 18 declare a result type (17 `ExtensionHandler<E, R>` plus `project_trust`) and so can
  intervene; the other 23 only observe.
- **OpenAI** has **5** lifecycle events on both `RunHooks` and `AgentHooks`: `agent_start`, `agent_end`, `agent_handoff`, `agent_tool_start`, `agent_tool_end`
  (O lifecycle.d.ts:14-140). All of them observe, and interception lives in separate typed options (`callModelInputFilter`, guardrails, `toolErrorFormatter`,
  `errorHandlers`).
- **Claude** has **33** `HookEvent` names (C:1032, C:1065). Of these, 22 have a `hookSpecificOutput` variant (C:10515-10530); the other 11 can only use the
  generic `continue`/`stopReason`/`systemMessage` fields.

### 1.3 The interceptor contract is the hard part, and each SDK made explicit choices

- **Observer failure is swallowed (Vercel).** `notify()` runs callbacks in parallel and catches every throw: "Errors in callbacks do not break the generation
  flow" (VS util/notify.ts). The docs say the same (VDOC 65-lifecycle-callbacks.mdx:48).
- **Interceptor failure fails closed (Pi tool gate).** `emitToolCall` does not catch handler errors (PX core/extensions/runner.js:965-979). `_beforeToolCall`
  rethrows them, or wraps a non-`Error` as "Extension failed, blocking execution" (PX core/agent-session.js:381-400). Context handlers, by contrast, log the
  error through `emitError` and carry on (PX core/extensions/runner.js:1014-1040).
- **Failure policy is configurable (Claude).** `HookCallbackMatcher.onFailure: 'continue' | 'block'` defaults to `continue` (C:1044-1062).
- **Composition order.** Pi's `tool_call` returns on the first `block`, and a later non-blocking result overwrites an earlier one (runner.js:968-977). `context`
  handlers chain, each seeing the previous output (runner.js:1014-1030). Claude runs PostToolUse hooks "in parallel on the ORIGINAL output, so an identity
  rewrite competes last-write-wins" (C:2884, `classifierContext` doc). Vercel middleware composes first-to-outermost: `[a, b]` → `a(b(model))` (VS
  middleware/wrap-language-model.ts:35-42; VDOC 40-middleware.mdx:39-50).
- **Hooks that must not throw.** Pi documents "Contract: must not throw or reject" on `transformContext`, `getApiKey`, `getSteeringMessages` and
  `getFollowUpMessages` (PC:188-261). It pushes error handling onto the hook author rather than the loop.
- **Rewrite by return value or by mutation.** Pi's `tool_call` rewrites arguments by in-place mutation ("mutate `event.input` in place", PX
  core/extensions/types.d.ts:1110). Claude (`updatedInput`, C:2964) and Pi's own `afterToolCall` (field-by-field replacement, PC:54-68) return a new value
  instead. Returning a value is easier to type, test and audit.
- **Async hooks.** Claude lets a hook return `{async: true, asyncTimeout}` to detach (C:153-156). Fields that need a synchronous answer are then "silently
  ignored" (C:2884).
- **Abort signal.** Pi passes `signal` into `beforeToolCall`/`afterToolCall` (PC:279, 293), and Claude passes it to every `HookCallback` (C:1037-1039). Vercel's
  observers get no signal.

## 2. Event streams: typed unions of start/delta/end parts, with a separate item layer for UIs

- **Vercel, three layers.** (1) The provider `LanguageModelV4StreamPart` (VP). (2) `TextStreamPart`, a 26-member union: `text-start|delta|end`,
  `reasoning-start|delta|end`, `tool-input-start|delta|end`, `tool-call`, `tool-result`, `tool-error`, `tool-output-denied`, `tool-approval-request|response`,
  `start-step`, `finish-step`, `start`, `finish`, `abort`, `error`, `raw`, `source`, `file`, `custom` (V:3139). (3) `UIMessageChunk` for the browser, with
  `tool-input-available`, `tool-output-available` and `reset-step` (V:2372-2520). Our fact-check found docs still reading the 6.x field `part.textDelta` and the
  type `'reasoning'` (docs/reference/vercel-ai-sdk/fact-check.md:81). Field renames inside a union are a silent break, because narrowing simply never matches.
- **Pi, two layers.** pi-ai's `AssistantMessageEvent` covers `start`, `text_*`, `thinking_*`, `toolcall_*`, `done` and `error`
  (verify/pi/node_modules/@earendil-works/pi-ai/dist/types.d.ts:592). The agent's `AgentEvent` wraps it in `message_update.assistantMessageEvent`, alongside
  message, turn and tool-execution events (PC:461-503). In-process events carry cumulative `partial` snapshots. The JSON/RPC wire form strips them:
  "`message_start` provides the initial message, deltas build it, and `message_end` provides the final authoritative message" (PX modes/json-event.d.ts:26-31).
  That split is a good pattern: cheap snapshots in process, deltas on the wire, and an authoritative final item.
- **OpenAI.** `RunStreamEvent = RunRawModelStreamEvent | RunItemStreamEvent | RunAgentUpdatedStreamEvent` (O events.d.ts:8-50). Raw events pass the model stream
  through. Item events wrap a completed `RunItem` with one of 10 names, among them `message_output_created`, `tool_called`, `tool_output`,
  `tool_approval_requested` and `compaction_item_created` (O events.d.ts:23). The raw layer is normalized to `output_text_delta`, `response_started`,
  `response_done` and a generic `model` item (O types/protocol.d.ts:2095-2115, 3000). UIs either consume `toTextStream()` or switch on item events (O
  result.d.ts:208-229).
- **Claude.** `query()` returns `Query extends AsyncGenerator<SDKMessage>` (C:3165). `SDKMessage` is a **40**-member union (C:5866): assistant and user
  messages, result, system/init, hook started/progress/response, task, rate-limit, compact boundary and more. Token deltas are opt-in through
  `includePartialMessages`, which yields `stream_event` messages wrapping raw Anthropic `BetaRawMessageStreamEvent`s (C:2000, C:6028-6040). Claude is the only
  SDK whose delta layer is provider-specific.
- **Convergent design.** Every SDK puts a `type` discriminant on plain objects. OpenAI's classes also carry a readonly `type`. Each SDK has a delta layer keyed
  by content id and an item layer of completed messages, tool calls and results. The item layer is what UIs and session logs persist. Hook activity also appears
  in the stream in Claude (`SDKHookStartedMessage`/`Progress`/`Response`, C:5866), and Pi emits extension errors through `emitError` (runner.js:497).
  Observability of the hooks themselves is a real requirement.

## 3. Model middleware: Vercel's three-slot wrapper is the reference design

- `LanguageModelV4Middleware` has `transformParams`, `wrapGenerate`, `wrapStream` and `override{Provider,ModelId,SupportedUrls}`, and is tagged with
  `specificationVersion: 'v4'` (VP:3503-3574). `wrapLanguageModel` first upgrades any V2/V3 model to V4 and then reduces the middleware list (VS
  middleware/wrap-language-model.ts:24-42). Built-ins include extract-reasoning, extract-JSON, simulate-streaming, default settings, default instructions and
  tool-input examples (VDOC 40-middleware.mdx:53-190; V:10081-10208). The docs' examples cover logging, caching, RAG and guardrails (VDOC
  40-middleware.mdx:325-471).
- Pi has no model wrapper. It gets the same effect through `streamFn` (pi-agent-core dist/stream-fn.d.ts) and the `before_provider_request` /
  `before_provider_headers` / `after_provider_response` extension events. OpenAI has a `Model` interface and `ModelProvider` but no middleware chain (O
  model.d.ts, providers.d.ts). Claude's model call happens inside the CLI process, so callers can't wrap it.
- Middleware belongs at the gateway boundary (AGENTS.md "Planned architecture" item 1). It sees provider-normalized params. Loop hooks such as `prepareStep` see
  agent-level state instead (tools, step number, messages). Vercel keeps the two apart: `prepareStep` is per step and can swap the model (V:3238-3241), while
  middleware is per model instance.

## 4. Public API shape: functions with options objects win, classes appear where state lives

- **Functional core.** Vercel's `generateText`/`streamText` each take one large options object (66 keys for `streamText`,
  docs/reference/vercel-ai-sdk/fact-check.md:47-48). They return a result object with promise getters and stream views. Methods on results are moving to
  standalone helpers: `result.toUIMessageStream()` is "@deprecated Use the standalone `toUIMessageStream` helper … removed in the next major" (V:2964-2980). The
  stateful agent is a class (`ToolLoopAgent`, exported as `Experimental_Agent`, V:11429). Claude is a single `query()` function returning an async generator
  with control methods (`interrupt`, `setPermissionMode`, `streamInput`; C:3165-3186, 3568, 3600).
- **Class-based.** OpenAI's `Agent` and `Runner` classes inherit `EventEmitterDelegate` (`on`/`off`/`once`/`emit`, O lifecycle.d.ts:7-13). Its positional hook
  arguments are already a regret: "Changing the list is a breaking change … If we revisit the argument data structure (e.g., migrating to a single object
  instead), more properties could be easily added" (O lifecycle.d.ts:24-34). Vercel passes one event object per callback (`Callback<EVENT> = (event) => …`,
  V:1090), and Pi passes `(event, ctx)` (PX core/extensions/types.d.ts:1224). **Lesson: one event object per hook, never positional arguments.**
- **Unsubscribe.** Pi's `on()` returns `() => void` (types.d.ts:1229). OpenAI requires `off()`. Vercel's callbacks are per call, so they need no unsubscribe.
- **Typed errors.** OpenAI: `AgentsError` carries `state?: RunState`, so callers can resume after `MaxTurnsExceededError`, guardrail tripwires and the rest (O
  errors.d.ts:11-14, 19-155). Vercel: `AISDKError.isInstance()` uses marker checks instead of `instanceof` across bundle copies (VP:2091-2116), with dozens of
  subclasses (`APICallError`, `NoSuchModelError`, …; V:11429). Claude: only `AbortError` (C:17). Its loop outcomes are `result` message subtypes such as
  `error_max_turns` rather than exceptions (docs/reference/claude-agent-sdk/fact-check.md:76). Our fact-check also found a misleading launch error for a missing
  `cwd` (same file:86).

## 5. Versioning and deprecation: four strategies, one clearly best documented

- **Vercel: an experimental → stable → removed pipeline.** Unstable options carry an `experimental_` prefix, and graduating one leaves a `@deprecated` alias.
  The 7.0 options type lists `experimental_onStart` next to `onStart`, and `experimental_onToolCallStart` next to `onToolExecutionStart`, so a graduation can
  include a rename (V:4145-4206). `index.d.ts` carries 143 `@deprecated` tags. 7.0.0 Major Changes include "make experimental_telemetry stable", "rename
  `stepCountIs` to `isStepCount`" and "remove experimental_customProvider" (VCL:1745-1759). Earlier majors removed `experimental_wrapLanguageModel` and the
  `experimental_output` alias (VCL:6544, 1950). Renames ship as alias exports: `isStepCount as stepCountIs` (V:11429), `system` → `instructions` (V:866),
  `onFinish` → `onEnd` (VCL:1821; V:4122). The CHANGELOG uses changeset entries (`<hash>: feat(ai): …` under Major/Minor/Patch headings, VCL:1745-1759). That is
  the changesets tool's format, where each PR declares its bump type and summary (https://github.com/changesets/changesets README; tool use inferred from
  format).
- **Vercel: spec-version adapters.** Providers implement `LanguageModelV2|V3|V4` with a literal `specificationVersion` (VP:1004, 1955, 2007).
  `resolveLanguageModel` accepts v4/v3/v2 (VS model/resolve-model.ts:35-45). `asLanguageModelV4` upgrades v2 → v3 → v4 through a `Proxy` (VS
  model/as-language-model-v4.ts:20-40), and a v2 model logs a compatibility warning (VS util/log-v2-compatibility-warning.ts). The provider contract versions
  separately from `ai`, so the 7.x core runs old providers. Telemetry keeps `LegacyOpenTelemetry` beside `OpenTelemetry` for the old span shape
  (verify/vercel-ai-sdk/node_modules/@ai-sdk/otel/dist/index.d.ts:116, 224).
- **Claude: runtime capability negotiation and `@alpha`.** `interrupt()` returns a receipt only "On CLIs advertising the `interrupt_receipt_v1` capability
  (system/init `capabilities`)", and older CLIs resolve `undefined` (C:3171-3179). `onFailure: 'block'` fails at startup on a CLI that lacks it (C:1050-1060).
  `sdk.d.ts` has 39 `@alpha` and 5 `@deprecated` tags (grep count). This fits a library that drives a separately versioned binary.
- **OpenAI: 0.x, no deprecation markers.** The `agents-core` `.d.ts` files contain no `@deprecated` tags at all (grep count, O). Under semver item 4, "Anything
  MAY change at any time" for 0.y.z (https://github.com/semver/semver/blob/master/semver.md).
- **Pi: breaking changes inside 1.x.** The 1.5.2 patch release and the 1.5.0 minor both carry "Breaking Changes" sections (PCL:3, 29-32, 134, 143). When Pi
  breaks something, it keeps the old field compiling as optional and deprecated (`GrepOperations.readFile`, PCL:31). Deprecated settings migrate (`queueMode` →
  `steeringMode`, docs/reference/pi/fact-check.md:48). Semver requires a major bump for incompatible changes and a minor bump for deprecations (semver items
  7-8, same URL), so Pi's practice diverges from it.
- **Docs drift is systematic.** The Pi docs site serves main, not the release: six pages ran ahead of v1.5.2 (docs/reference/pi/fact-check.md:74). Pi READMEs
  import deprecated helpers that exist only in `/compat` (same file:77). Vercel examples use 6.x stream-part names and `generateObject` options
  (docs/reference/vercel-ai-sdk/fact-check.md:81-85). Vercel's tables omit `onLanguageModelCallStart/End` on `ToolLoopAgent` and don't mention the `stepCountIs`
  alias (same file:95). The CHANGELOG shows those callbacks were typed late: "formally include already supported `onLanguageModelCallStart`… in
  `ToolLoopAgentSettings`" (VCL:872). The Claude reference omits 20 exported items, most of them `@alpha` (docs/reference/claude-agent-sdk/fact-check.md:92).

## 6. Telemetry: OTel GenAI spans map one-to-one onto the hook moments

- OTel GenAI agent spans are still **Development** stability. They define `create_agent`, `invoke_agent {gen_ai.agent.name}` (or `invoke_workflow`), `plan` and
  `execute_tool {gen_ai.tool.name}`. `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` are opt-in because they may be sensitive
  (https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-agent-spans.md and …/execute-tool.md). The conventions
  moved out of the core semconv repo into `semantic-conventions-genai`
  (https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/gen-ai/gen-ai-agent-spans.md). opentelemetry.io was unreachable from this
  session.
- `@ai-sdk/otel` builds its spans from the lifecycle callbacks. The `Telemetry` interface has the same `onStart…onEnd` methods (V:4991-5145), and the emitted
  attributes include `gen_ai.operation.name` values `invoke_agent`, `chat` and `execute_tool`, plus `gen_ai.usage.cache_read.input_tokens` (grep of @ai-sdk/otel
  dist/index.js:147, 855, 1459). Integrations attach through `telemetry.integrations` (V:1124-1166).
- OpenAI ships its own tracing model: `TracingProcessor` with `onTraceStart/End`, `onSpanStart/End`, `shutdown` and `forceFlush` (O
  tracing/processor.d.ts:7-37). Its span types are `agent`, `turn`, `function`, `generation`, `response`, `handoff`, `guardrail`, `mcp_tools` and others (O
  tracing/spans.d.ts:6-113), and `traceIncludeSensitiveData` gates content (O run.d.ts:101). Claude correlates hooks and OTel through a `prompt_id` shared by
  both (C:196-198). Pi has a vendor-neutral `pi-telemetry` package ("Vendor-neutral telemetry contracts", its package.json).

## Design implications for our SDK

1. **Separate observers from interceptors by type, not by convention.** Observers get `(event) => void | Promise<void>`. Errors are caught and reported as an
   `error` event, never thrown into the loop (Vercel `notify`, §1.3). Interceptors return a typed decision, run sequentially in registration order, and fail
   closed for gates (Pi `tool_call`, §1.3), with an `onFailure` override (Claude, §1.3).
2. **Minimal interceptor set (6), matching AGENTS.md's planned hooks:**
   - `beforeModelCall(ctx) → {messages?, system?, tools?, model?, params?}`. It merges Vercel `prepareStep` with OpenAI `callModelInputFilter` and Pi
     `prepareRequest`.
   - `transformContext(messages, signal) → messages`. This is the compaction and pruning seam (Pi `transformContext`, `context`).
   - `afterModelCall(ctx, message) → {message?}` (Pi `message_end`).
   - `beforeToolCall(ctx, call, signal) → {decision: 'allow'|'deny'|'ask', input?, reason?, terminate?}`. It merges Claude `PreToolUse` with Pi's `{block,
     terminate}`; the input is returned, never mutated in place.
   - `afterToolCall(ctx, call, result) → {content?, isError?, terminate?}`, with field-wise replacement (Pi `AfterToolCallResult`).
   - `shouldStop(ctx, step) → boolean | {continue: message}`. It merges Vercel `stopWhen`, Pi `finishTurn` and Claude `Stop` with `additionalContext`.
   The steering queue is an API, not a hook: `run.steer(msg)` and `run.followUp(msg)`, drained at step boundaries (Pi
   `getSteeringMessages`/`getFollowUpMessages`, RPC `steer`/`follow_up`; Vercel `experimental_steering`).
3. **One event object per hook, carrying `runId`, `stepIndex`, `callId`, `signal` and a monotonic timestamp.** No positional arguments (OpenAI's regret, O
   lifecycle.d.ts:24-34). `on()` returns an unsubscribe function (Pi).
4. **The event union stays small and layered.** `run_start | run_end | step_start | step_end | model_call_start | model_call_end | text_start | text_delta |
   text_end | reasoning_start | reasoning_delta | reasoning_end | tool_input_start | tool_input_delta | tool_input_end | tool_call_start | tool_call_update |
   tool_call_end | approval_request | steer_applied | compaction | hook_error | error | abort`. Every delta is keyed by a content id, and every `*_end` carries
   the authoritative item, which the session log persists (Pi wire rule §2; OpenAI item events). The SDK does not pass raw provider events by default; an opt-in
   `raw` part covers them (Vercel `includeRawChunks`, V:4075).
5. **Model middleware lives at the gateway with Vercel's three slots** (`transformParams`, `wrapGenerate`, `wrapStream`) and documented first-is-outermost
   ordering (VP:3503-3574). Lifecycle observers emit OTel `gen_ai.*` spans (`invoke_agent`, `chat`, `execute_tool`) through one built-in observer, not a second
   hook system (@ai-sdk/otel, §6). Content attributes stay opt-in.
6. **Typed errors carry resumable state** (OpenAI `AgentsError.state`). The SDK checks errors with an `isInstance` marker rather than `instanceof` (Vercel
   `AISDKError`), and keeps loop outcomes such as max-steps as result variants as well as errors (Claude `error_max_turns`).
7. **Versioning rules.**
   - Mark unstable surface with an `experimental_` prefix and a JSDoc `@experimental` tag. Graduating it keeps a `@deprecated` alias for one major (Vercel §5).
   - A rename ships as an alias export in a minor release and is removed in the next major (semver item 7/FAQ; Vercel `stepCountIs`).
   - Version the provider and model contract separately (`specificationVersion: 'v1'`), and ship upgrade adapters for older versions (Vercel V2→V4).
   - Version the event and wire schemas with an advertised capability list in `run_start` (Claude `interrupt_receipt_v1`).
   - Use changesets with one bump per PR, and run a CI check that fails on new exports missing from the docs and on doc names absent from the `.d.ts` (our Tier
     3 diffs caught every drift in §5).
   - Build docs from the release tag, not from main (Pi F1).
   - Until 1.0, still mark breaking changes in the changelog. After 1.0, never ship "Breaking Changes" in a patch (Pi PCL:29).

## Unresolved gaps

- OpenTelemetry docs (opentelemetry.io) and semver.org were unreachable here. OTel claims come from the raw GitHub markdown on `main` (Development stability,
  may change), and semver quotes come from the raw `semver.md` on GitHub, as summarized by the fetch tool.
- The changesets docs (changesets.dev) were not read. The claim that Vercel uses changesets is inferred from CHANGELOG format.
- We did not run hooks to confirm ordering or concurrency (e.g. whether Claude PreToolUse hooks run in parallel). Claims rest on `.d.ts` comments and Pi's JS
  source.
- OpenAI's JS for hook error handling (does a throwing `RunHooks` listener abort the run?) was not traced.
