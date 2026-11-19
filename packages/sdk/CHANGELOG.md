# @buildanagent/sdk

## 0.1.0-alpha.10

### Minor Changes

- 0d5dede: Breaking Changes: `continueRun()` now resumes a paused context instead of refusing it, and refuses a context whose last assistant message has a tool call with no result and no pending request. That context used to reach the model with "No result was recorded for this tool call"; it now throws `SdkError` `invalid_run_options`, because its pause record was lost. A question from `clarificationTool()`, or any tool result with `pause`, now ends the run with the new stop reason `clarification_requested` and a signed `clarification` request in `pending`, instead of `stopped` with `stoppedBy: "clarification"`; the asking call gets no result until it is answered. `AgentEvent` gains `resolution_rejected`, so a `switch` over `RunResult["stopReason"]` or `AgentEvent["type"]` that was exhaustive needs a case for each.
  
  New: `continueRun(context, { resolutions, recheck })` verifies each waiting call's signed request with the run's `signer` and the input in `context.pendingInputs`. A verified `allow` runs the call once with the input its request signs and without `beforeToolCall`, after `recheck` allows it. A `deny` or an `answer` reaches the model as the call's result. A request or resolution that fails a check runs nothing, emits `resolution_rejected`, and asks again with a new request. Settling the requests is not a step. `blockingApprovals(handler)` answers approvals inside the run after emitting `approval_request`, and joins through `composeInterceptors()`. New exports: `ContinueOptions`, `ClarificationRequestedResult`, `ApprovalHandler`, `ApprovalDetails`, `ResolutionRejectionCause`, and the safety package's `Recheck` and `RejectionCause` types.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.10

## 0.1.0-alpha.9

### Minor Changes

- 645e006: Breaking Changes: a `beforeToolCall` gate that returns `ask` now pauses its call instead of blocking it. The run ends with the new stop reason `awaiting_approval`, whose `AwaitingApprovalResult` carries `pending`, one signed `SignedPendingRequest` per waiting call; `context.pending` holds the same requests, `context.pendingInputs` holds the input each one signs (the input the call would run with, after coercion, `repair` and any gate's replacement), and the new `approval_request` event reports each request with that input. An `ask` may carry an `input`, and `composeInterceptors()` passes an earlier gate's replacement on that way when a later gate asks.
  
  `idGenerator` now also makes request ids; one that repeats the run's id or an earlier request's id is replaced by a random UUID. A `switch` over `RunResult["stopReason"]` or `AgentEvent["type"]` that was exhaustive needs a case for each, and code that relied on `ask` blocking the call must now handle the pause. `continueRun()` throws `invalid_run_options` for a context with pending requests until it can resume them.
  
  New: the `signer` run option (default `ephemeralSigner()`), `createPendingRequest()`, which signs the same record outside a run, and re-exports of `ApprovalSigner`, `ephemeralSigner()`, `hmacSigner()`, `canonicalInputHash()`, `SignedPendingRequest`, `Resolution`, `SignPendingOptions`, `SafetyError` and `isSafetyError()` from the safety package, unchanged.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.9

## 0.1.0-alpha.8

### Minor Changes

- 835ad4c: New: `@buildanagent/sdk/otel` exports `otelObserver()`, an observer that turns a run into OpenTelemetry GenAI spans: one `invoke_agent` span, a `chat` span for each model call and an `execute_tool` span for each tool call. Spans carry no content unless you pass `captureContent: true`, and go only to the tracer you pass. The observer takes the trace context through the `parentContext` option and the required `childContext` option, offers `flush()` for `waitUntil`, and offers `endRun()` to end the spans of a run that threw. The subpath also exports the attribute-name constants, `SEMCONV_GENAI_COMMIT` and the structural types for the tracer and the observer. `@opentelemetry/api` is not a dependency of the SDK.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- 6a9aedd: Breaking Changes: `AgentEvent` has a new `steer_applied` type, so an exhaustive `switch` over `event.type` stops compiling until it handles the new case. `SdkErrorCode` also gains `undelivered_message`.
  
  New: a `Run` has `steer(message)` and `followUp(message)`. Each queues a user message and returns a `DeliveryReceipt` (`id`, `kind`, `message`, `stepIndex`) once the message is in the transcript. A steer is applied before the next model call, never inside a running model call or tool batch. A follow-up waits until the run would end, then extends it by one step. Each message also emits one `steer_applied` event.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- ced295e: Breaking Changes: `RunResult` has a new `budget` variant and `RunError.kind` a new `unknown_price` value, so an exhaustive `switch` over either stops compiling until it handles the new case. Every run now also ends `no_progress` after 3 identical failing tool calls in a row; pass `progress: false` to turn that off.
  
  New: `run()` takes `budgetUsd`. Before each call it projects the cost with `projectCallCost()` (now re-exported) and, if the call could pass the cap, ends the run `budget` without making it. A budgeted run on a model with no price ends with `error.kind: "unknown_price"` before its first call.
  
  New: a tool can declare `progressKey()`, and 5 calls with one key and no success end the run `no_progress`. `progress` changes both thresholds.
  
  New: `depth` and `maxDepth` set the nesting that tools read from `ctx`. `run()` throws `max_depth_exceeded` for a run nested past the cap, and `nestedRunDepth(ctx)` gives a spawning tool the options for its child run.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.6

## 0.1.0-alpha.5

### Minor Changes

- ea66aa6: Breaking Changes: an exhaustive `switch` over any of these needs the new cases.
  
  - `RunResult` has a new variant, `NoProgressResult` (`stopReason: "no_progress"`, with a `reason`).
  - `RunError.kind` has a new value, `"hook"`.
  - `AgentEvent` has two new event types, `context_transformed` and `hook_error`.
  - `SdkErrorCode` has two new codes, `invalid_hook_result` and `hook_failed`.
  
  `run()` also starts its loop one microtask later. `run.abort()` called right after `run()` now stops the run before its first model call, and does nothing once the run has its outcome and is ending. Nothing else changes for code that passes no hooks.
  
  Runs now take hooks. Six interceptors can change a run, and observers only watch it:
  
  - **`interceptors`** is one object with `transformContext`, `beforeModelCall`, `afterModelCall`, `beforeToolCall`, `afterToolCall` and `shouldStop`. Each takes one frozen event object and returns a replacement. `transformContext` and `beforeModelCall` change one request without touching the transcript, `activeTools` sends deferred tools, `beforeToolCall` allows, denies or rewrites a call in model order before any call of the step starts, `afterToolCall` replaces a result, and `shouldStop` ends a run `stopped` or `no_progress`, or keeps a text answer going.
  - **A throwing hook fails closed.** A failed gate denies the call, a failed `afterToolCall` withholds the result, and any other failed hook ends the run with `error.kind: "hook"`. `onFailure: "continue"` skips the failed hook instead. A hook that returns the wrong shape throws an `SdkError` with the new code `invalid_hook_result`.
  - **`composeInterceptors()`** joins several interceptor objects, with the order and merge rules in the README.
  - **`observers`** and **`run.on()`** deliver every event in order, each as a frozen copy. An observer that throws or rejects becomes a `hook_error` event and never changes the run. The run waits for observers before `agent_settled` and `run_end`, for at most the new `observerTimeoutMs` option (1 to 2147483647, default 10000) each time, and removes an observer that hasn't caught up by then.
  - **`tool_call_end.input`** holds the input a `beforeToolCall` gate put in place of the model's, when it replaced it.
  
  New events: `context_transformed` and `hook_error`. New types: `Interceptors`, `Observer`, the six event types, `ModelCallPatch`, `GateDecision`, `StopDecision`, `ToolResultPatch`, `HookEventBase`, `CallOptions`, `MaybePromise`, `OrNothing` and `NoProgressResult`.
  
  Inside the loop, a failure while recording one tool result now cancels the step's other tool calls, waits for them, and still records their results before it throws the error.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.5

## 0.1.0-alpha.4

### Minor Changes

- b929321: Breaking Changes: a step's tool calls now start together instead of one at a time. A tool that relied on running after the calls before it must set `executionMode: "sequential"`, which runs its whole step in the model's order. Two other changes reach every run. The run emits `tool_call_start` for all of a step's calls before the first one executes. `ToolFailure`'s `not_run` kind has a new `reason`, `"sibling_failed"`, so an exhaustive `switch` over it needs a case.
  
  When the model calls several tools in one response, the run checks each call in order, then starts them all at once and adds their results to the transcript in the model's order, whichever finishes first. New settings on `defineTool()`:
  
  - **`executionMode: "sequential"`** makes every call in that step run one at a time, in order.
  - **`resourceKey(input)`** names what a call touches, such as a file path. Calls with the same key never overlap and run in the model's order, even across tools.
  - **`firstParty` and `annotations.readOnlyHint`**: a first-party tool marked read-only, with no `effect`, lets its calls that share a key run together. The hint of a tool that isn't first party, such as an MCP tool, never changes scheduling.
  
  `ctx.signal` now also fires when a sibling call in the same step throws a programmer error (an `SdkError`), and a call still waiting for its key then gets an error result instead of running. A sibling's error result, such as invalid input or a tool that threw, cancels nothing. `defineTool()` throws `invalid_tool_definition` for an `executionMode` that isn't `"parallel"` or `"sequential"` and for a `resourceKey` that isn't a function, and a call whose `resourceKey` throws or returns a non-string throws the same error. The new types `ToolAnnotations` and `ToolExecutionMode` are exported.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.4

## 0.1.0-alpha.3

### Minor Changes

- 1adde94: Breaking Changes: the gateway's `StreamContractError` and `ModelRequestsDisabledError`, and the SDK's `UnexpectedModelCallError`, now extend their package's error class, which changes four things you may rely on:
  
  - `isGatewayError()` now returns true for `StreamContractError` and `ModelRequestsDisabledError`, and `isSdkError()` for `UnexpectedModelCallError`. If you check the guard before the class, check the class first, or switch on `code`: `stream_contract`, `model_requests_disabled` or `unexpected_model_call`.
  - `GatewayErrorCode` and `SdkErrorCode` have new members, so an exhaustive `switch` over either needs a case for each.
  - `GatewayError.name` and `SdkError.name` are typed `string`, not a string literal, because the subclasses set their own names. Compare `name` with a string, or use the guards.
  - The constructors of `ModelRequestsDisabledError` and `UnexpectedModelCallError` take one required `message` and no `ErrorOptions`. Pass the message alone.
  
  Run your agent with `run()`. The loop sends your system prompt and the user's message to the model, runs each tool the model calls, one at a time and in order, and sends the results back until the model answers without calling a tool. A tool whose `exposure` is `"deferred"` or `"hidden"` is never sent to the model.
  
  - **Stop reasons, not exceptions.** A run ends with a result whose `stopReason` is `done`, `max_steps`, `error`, `aborted` or `stopped`, the last when a `clarificationTool()` asked the user a question. `maxSteps` counts model calls and defaults to 20; reaching it emits a `warning` event with `code: "max_steps"`. An `error` result copies the failed call's `kind`, such as `overflow`, with its message and HTTP status. Only the `done` result carries `output`, so TypeScript rejects `result.output` until you have checked the stop reason. Every result carries the summed `usage` and `cost`, the messages the run added, and a `context` to continue from.
  - **Output tools end the run.** Pass an `outputTool()` as `output`: once the model calls it with input that passes the schema, the run ends `done` with the validated answer as `result.output`. A call that fails the schema spends one model call.
  - **`runOrThrow()` and `continueRun()`.** `runOrThrow(run)` returns a `done` result and throws a `RunStoppedError`, carrying the result and its context, for any other. `RunStoppedError.isInstance()` recognises it. `continueRun(context, options)` goes on from a stored context.
  - **Aborts leave a well-formed transcript.** `run.abort()` or the `signal` option stops the run. Every tool call keeps a result, calls that hadn't started get an error result, and the last message is an assistant message with `stopReason: "aborted"`.
  - **One closed set of events.** Iterating a run streams its events from the first one: `run_start`, the step and model-call events, the text, reasoning and tool-input deltas, the tool-call events, `retry`, `warning`, `error`, `abort`, `agent_settled` and `run_end`. `AGENT_EVENT_TYPES` lists every type, and a run emits no other.
  - **Errors you can recognise by code.** `SdkError` gains the codes `invalid_run_options`, `invalid_model_stream`, `run_stopped` and `unexpected_model_call`; `UnexpectedModelCallError` is now an `SdkError`. In the gateway, `StreamContractError` and `ModelRequestsDisabledError` are now `GatewayError`s, with the codes `stream_contract` and `model_requests_disabled`, so `isGatewayError()` returns true for them. The gateway also exports `addCost()`, which adds two costs by the rule a retried call's cost already follows.
  - **`ScriptedModel.assertComplete()` catches over-runs.** It now also throws when the model was called after its last scripted step. Behind `createModel()`, a run reports such a call as an `error` result, not a throw, so this check is what fails the test.

### Patch Changes

- Updated dependencies [1adde94]
  - @buildanagent/gateway@0.1.0-alpha.3

## 0.1.0-alpha.2

### Minor Changes

- 2d6d028: Define your agent's tools with `defineTool()`, `outputTool()` and `clarificationTool()`. This release only defines and checks tools: the loop that calls the model and runs them comes in a later release, and the rules below apply to every call it makes. A tool's input schema is either a Standard Schema that can describe itself as JSON Schema, such as a Zod 4.2 schema, or raw JSON Schema, draft 2020-12 or draft 7. `defineTool()` compiles the schema when you call it, so a broken tool throws at once.
  
  - **Validation and repair.** Each call's arguments are coerced by three listed rules, such as `"42"` to `42` for an integer field, and then validated. An optional `repair` hook gets one chance to fix invalid input.
  - **Errors the model can fix.** An unknown tool, invalid input or a throwing `execute` becomes an error result, never an exception. The model reads the failing JSON Pointer paths, the arguments it sent and an instruction not to substitute invented data. `formatError` replaces that text, and `redactErrors: true` keeps a thrown message out of the model's view and in `details`.
  - **Calls that never run.** No call runs from a response that stopped at the output limit, ended in an error or was aborted, and no call starts once the run is cancelled. Each such call gets an error result instead; after a cut-off response, the model is asked to send the call again.
  - **Write outcomes.** A tool that changes the world declares `effect: { kind: "write" }` and may return an `outcome`. The model reads the outcome's sentence and fields first, and every kind except `applied` marks the result as an error.
  - **`SdkError` for mistakes in your code.** The SDK throws `SdkError`, with a typed `code`, for a bad tool definition, a malformed tool result or an invalid outcome. `isSdkError()` recognises it.
  
  The SDK now needs Node 22.19 or later, the oldest release its validator, pi-schema 1.5.2, supports.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- ee97e50: Breaking Changes: a reply whose usage the provider never reported now costs `null`, not $0, and a `ScriptedModel` script without `usage` now reports no usage. To keep a known zero in a test, pass `usage: {}`. In a budget, handle `cost.total === null`. Retries now wait as long as the provider asks, and stop when it asks for more than 60 seconds.
  
  - **Unreported usage costs `null`, not $0.** A reply that ends without usage now has `usage.unreported: true` and a cost of `{ total: null, basis: "unknown" }`. Common cases are a request whose connection fails before any response, an OpenAI-compatible stream without its usage chunk, and an Anthropic stream that never reports its final `output_tokens` after content began. Before, these were priced as a known $0, which a budget would count as free. `unreportedUsage()` builds such a record for an adapter you write. A provider-billed total still wins, and an HTTP error response still counts as zero tokens.
  - **Retries honour `retry-after`.** Both adapters read `retry-after` (seconds or an HTTP date) and `retry-after-ms` from a failed response and put the hint on `error.retryAfterMs`. `createModel()` waits for the longer of its backoff and the hint, capped at 60 seconds. A hint over 60 seconds ends the call with the `retryable` error and no `retry` event, so you can wait and call again. `quota`, `overflow` and `fatal` errors are still never retried.
  - **`ScriptedModel` scripts without `usage` report none.** Such a response's usage is now `unreported`, so it is priced as unknown. Pass `usage: {}` to script a response that reports zero tokens.

### Patch Changes

- Updated dependencies [ee97e50]
  - @buildanagent/gateway@0.1.0-alpha.1

## 0.1.0-alpha.0

### Minor Changes

- First public release, holding the testing export; the agent loop comes in a later release.
  
  - **`ScriptedModel`.** Plays back scripted responses, one per model call, and fails a test whose calls drift from the script: a call past the last step throws `UnexpectedModelCallError`, and `assertComplete()` throws if a step was never used.
  - **Deterministic helpers.** `fixedClock()` and `sequentialIds()` give the same clock readings and ids on every run.

### Patch Changes

- Updated dependencies
  - @buildanagent/gateway@0.1.0-alpha.0
