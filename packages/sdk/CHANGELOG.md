# @buildanagent/sdk

## 0.1.0-alpha.43

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.43

## 0.1.0-alpha.42

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.42

## 0.1.0-alpha.41

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.41

## 0.1.0-alpha.40

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.40

## 0.1.0-alpha.39

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.39

## 0.1.0-alpha.38

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.38

## 0.1.0-alpha.37

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.37

## 0.1.0-alpha.36

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.36

## 0.1.0-alpha.35

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.35

## 0.1.0-alpha.34

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.34

## 0.1.0-alpha.33

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.33

## 0.1.0-alpha.32

### Minor Changes

- ec8a6e0: Export the content helpers of the OpenTelemetry observer from @buildanagent/sdk/otel (inputMessagesJson, outputMessagesJson, systemInstructionsJson, resultParts and jsonValue), so a span rebuilt from a session log holds content in the format a live run writes

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.32

## 0.1.0-alpha.31

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- 7d87f8f: First public alpha of `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety`, which now version and publish with the gateway and the SDK as one group of six at one version. The gateway and the SDK have no change of their own in this version: they move with the group.
  
  The protocol is the JSON-RPC wire between a client and the harness. It gained four additions before this release:
  
  - `session/open` takes `fromSeq`, which replays a session's entries from that sequence number before any live event.
  - An `events_dropped` event tells a client that is reading too slowly how many events it missed, so it can reopen with `fromSeq`.
  - `$/cancelRequest` withdraws a request.
  - `stdioTransport()`, from `@buildanagent/harness/server`, serves one client over a pair of byte streams with one JSON-RPC message per line. The CLI's `buildanagent rpc` command serves the protocol that way over standard input and output.
  
  The session format records which MCP server connected. An `extension_loaded` entry of tier `mcp` now carries an optional `mcp` member, a `McpServerRecord`: the `transport` (`stdio` or `in_process`), the negotiated `era` (`2026-07-28` or `legacy`), a `toolsHash` and, for a stdio server only, a `commandHash`. The `toolsHash` is `sha256:` and the hex digest of the canonical JSON of the tool list the server sent, sorted by name, each tool as its name, description and input schema, before the harness strips regular-expression keywords from the schemas. The `commandHash` is `sha256:` and the hex digest of the canonical JSON of `[command, ...args]`. The hash is not salted, so a reader of the log can confirm a guessed argument by hashing it. Keep secrets out of a server's arguments.
  
  A validator built from the earlier session-entry JSON Schema refuses an entry that carries `mcp`, because that schema sets `additionalProperties: false` on `extension_loaded`. `formatVersion` stays 1, so rebuild the validator from the published schema.
  
  The harness gained an MCP client, at `@buildanagent/harness/mcp`:
  
  - `createMcpManager()` connects each configured server on its own and registers its tools as `mcp__<server>__<tool>`, deferred behind tool search.
  - `connectMcpServer()` connects one server without registering anything, and its `signal` option aborts the connect and closes the server.
  - `McpError` reports a server that could not connect, a tool list the harness refuses, and a tool call that ended with no result; for the last, its `failure` member (an `McpCallFailure`) says why: `closed`, `timeout`, `aborted`, `input_required` or `server_error`.
  - `killMcpServersOnSignal()` ends every server on `SIGINT`, `SIGTERM` or `SIGHUP`. Signal handling is opt-in, because a listener changes what a signal does to the host.
  
  `ToolRegistry.registerAll()`, at `@buildanagent/harness/tools`, registers a list all or none: when any tool is refused, it removes what it added.
  
  `HarnessErrorCode`, exported from `@buildanagent/harness`, gained four values for the client: `invalid_mcp_config`, `mcp_connect_failed`, `mcp_tool_list_refused` and `mcp_call_failed`. The harness strips `pattern`, `patternProperties` and `format` from a server's input schemas, so it never runs a server's regular expression on the model's input, and `tool_search` no longer quotes an untrusted tool's description: it gives the tool's name and source. The harness now depends at runtime on `@modelcontextprotocol/client` 2.4.0.
- Updated dependencies [7d87f8f]
  - @buildanagent/gateway@0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- Updated dependencies [a3db5d1]
  - @buildanagent/gateway@0.1.0-alpha.27

## 0.1.0-alpha.26

### Minor Changes

- 179e1e7: `SDK_VERSION` is now exported. It is the string `run_start.sdkVersion` carries, so a host that writes a session's header before the run starts, as the harness does, can stamp the same version.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.26

## 0.1.0-alpha.25

### Patch Changes

- e4395da: Document every export, so the generated API reference has a description for each function, class, interface and type
- Updated dependencies [e4395da]
  - @buildanagent/gateway@0.1.0-alpha.25

## 0.1.0-alpha.24

### Minor Changes

- 0785fba: Breaking Changes: `beforeModelCall` now returns `ModelCallPatch | ModelCallStop`, and `ModelCallPatch` gains `stop?: never`. Code that calls a hook itself and reads `patch?.system` or `patch?.activeTools` must narrow the result first. A patch that carried a stray `stop` key now ends the run when the key is valid text and throws `invalid_hook_result` when it is not. Remove the key.
  
  `beforeModelCall` can now return `{ stop: "reason" }`, which ends the run before that call, the first one included. Nothing is sent to the model, no `model_call_start` event is emitted, and the run ends `stopped` with the reason as `stoppedBy`. `composeInterceptors()` ends the check at the first stop. A program versioned apart from the SDK can check for the new `before_model_call_stop_v1` capability before it relies on a stop.
- 39d30d2: Breaking Changes: a pause now binds the run's `app` into its signed request as `appHash`, a MAC that the run's signer makes over the tagged canonical JSON of `app`. `continueRun()` checks it right after the signature, before the call and input checks. An `app` that is missing or different ends the run with an `error` result of kind `app_mismatch`, and in a run that has `app`, a request that fails its signature or shape check ends it with kind `request_unverified`, instead of being asked again for whoever resumed. A resume whose `app` has no canonical form ends with `app_unhashable`. Each ends with `run_end` and runs no approved call. Pass the original caller's `app` back, not the approver's.
  
  A run with a `beforeToolCall` gate now throws `invalid_run_options` at once for an `app` with no canonical JSON form, such as one holding a `Date`, because a pause could not bind it. `RejectionCause` and `RunError.kind` gain members, and `createPendingRequest()` accepts an `app`.
  
  A pause saved before this release has no `appHash`, binds nothing and still resumes with any `app`. A request signed with an `appHash` uses a second signature layout, so an older SDK refuses it.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.24

## 0.1.0-alpha.23

### Minor Changes

- c5536da: Breaking Changes: `run()` and `continueRun()` now require an `app` that has every app type the tools declare, so a typed tool beside an untyped one needs it, and `null` is refused. `AppRequired` is replaced by `AppFor`, which reads the type of the `tools` list. The second type parameter of both functions is now that list, not the app type, so drop it from a call such as `run<Triage, Session>()`.
  
  Note: a resumed run takes its `app` from the process that resumes it, and a signed request does not bind it, so store the original caller's `app` and pass it back.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.23

## 0.1.0-alpha.22

### Minor Changes

- a4ba3cb: Breaking Changes: `ToolContext` now has an `app` field, so a `ToolContext` you build by hand in a test needs one. The field comes from a new `app` option on `run()` and `continueRun()`, and `ToolDefinition` and `defineTool()` take a third type parameter for its type. The caller sets `app` when a run starts, each tool reads it as `ctx.app`, and the model never sees it. A run whose tools declare its type must pass it.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.22

## 0.1.0-alpha.21

### Patch Changes

- b450b28: Add `parentRun` to `RunOptions`, which `nestedRunDepth()` sets. A nested run's `run_start` now carries `parentRunId` and `parentCallId`, and `otelObserver()` places the run's span under the calling tool's span.
- @buildanagent/gateway@0.1.0-alpha.21

## 0.1.0-alpha.20

### Patch Changes

- f8df359: Add retryAfterMs to RunError when the failure that ended the run carried a retry-after hint
- Updated dependencies [5e87946]
  - @buildanagent/gateway@0.1.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- 0b0d4a4: Fix ScriptedModel cloning a scripted tool_call's input only when it also generates a callId, so mutating an emitted input no longer corrupts the script or later runs of the same step
- @buildanagent/gateway@0.1.0-alpha.19

## 0.1.0-alpha.18

### Minor Changes

- c89c076: Breaking Changes: `SafetyErrorCode` gains `invalid_plan`, the code the safety package throws for a plan approval it can't sign or show, such as one whose steps are out of order. The SDK never throws it, but a `switch` over every code now needs a case for it.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.18

## 0.1.0-alpha.17

### Minor Changes

- 26aea2d: New: the SDK re-exports the safety package's `verifyResolution()`, with its `ResolutionCheck`, `VerifyResolutionOptions` and `PendingCall` types, so code that signs a request with `createPendingRequest()` can check a person's answer before the call runs, as `continueRun()` does. The check accepts any key the signer's ring holds.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.17

## 0.1.0-alpha.16

### Minor Changes

- 7840c5b: `run_start` now carries a real `defaultsHash` and `capabilities` instead of the reserved empty values. The SDK exports both: `DEFAULTS_HASH`, a SHA-256 over every default value, built-in prompt and tool description the SDK uses, and `CAPABILITIES`, the thirteen behaviours this release supports, such as `steering_v1`. A future change to a default changes the hash and is named in the changelog. Both packages now ship an `llms.txt` that indexes the README and lists every public export. The gateway README's `assertStreamContract()` example now passes `model.ref`, as `ModelAdapter.stream()` requires. No default, prompt or tool text changed.

### Patch Changes

- Updated dependencies [7840c5b]
  - @buildanagent/gateway@0.1.0-alpha.16

## 0.1.0-alpha.15

### Minor Changes

- a1a0e6a: Breaking Changes: `AgentEvent` and `AGENT_EVENT_TYPES` gain `raw`, so an exhaustive `switch` over `event.type` needs a `raw` case. `run()` and `continueRun()` gain `includeRaw` (default `false`): with it set, each model call asks the gateway for the provider's own events, and the run emits each as a `raw` event between `model_call_start` and `model_call_end`. The run's option alone decides, so `CallOptions` leaves `includeRaw` out. Raw events stay out of the transcript, the interceptors, the OpenTelemetry spans and recorded pairs, and a `StreamScript`'s raw events play only when the call sets `includeRaw`.

### Patch Changes

- Updated dependencies [a1a0e6a]
  - @buildanagent/gateway@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- b7c1318: Breaking Changes: every `retry` event now carries a required `layer`, `"gateway"` for an HTTP request the model re-sends and `"turn"` for a model call the loop re-issues. Code that builds a `retry` event, such as a test fixture, must add it; code that reads one is unaffected. `run()` and `continueRun()` gain `turnRetries` (default 0, so a failure still ends the run `error`), `turnRetryDelayMs` and `sleep`: with `turnRetries` set, the loop calls the model again after a call that ended with a `retryable` error, such as a stream cut off after output began. Every attempt is its own step and counts against `maxSteps`. A failed attempt's usage and cost count in the result and the budget.

### Patch Changes

- Updated dependencies [b7c1318]
  - @buildanagent/gateway@0.1.0-alpha.14

## 0.1.0-alpha.13

### Minor Changes

- 738a91a: Breaking Changes: `SafetyErrorCode` gains three codes for the safety package's USD cap on AI SDK calls: `invalid_budget` for a cap that isn't a finite number of dollars, 0 or more; `budget_exceeded` for a call refused because it would pass the cap; and `unknown_price` for a call refused because its cost can't be checked. The SDK never throws them, but a `switch` over every code now needs a case for each. `SafetyError`'s `name` is now typed `string`, so a subclass can carry its own name.

### Patch Changes

- @buildanagent/gateway@0.1.0-alpha.13

## 0.1.0-alpha.12

### Minor Changes

- 46f4a9c: Breaking Changes: `SdkErrorCode` gains `invalid_recording`, `recording_expired` and `recording_mismatch`, and `ScriptStep` gains `StreamScript`, so an exhaustive `switch` over either needs a case for each.
  
  New in `@buildanagent/sdk/testing`: `autoResponder()` answers like a cooperative model, calling one offered tool with input from `synthesizeInput()` and then answering in text. It never calls a tool on `DEFAULT_DENIED_TOOLS` (the shell, file-editing and screen tools of the agent SDKs we verify, such as `bash`, `exec_command`, `apply_patch`, `write` and `edit`), and `denyTools` adds names or patterns. `recordPairs(model, { providerVersion, expiresAt })` records each call as a normalised request and response with every credential header and API key left out of its options, and `replayPairs(pairs)` plays them back through a `ReplayModel`. A replay refuses an expired recording, one from another SDK release line, one whose stamp differs from `expect`, and a call that sends a request other than the recorded one, each with a `RecordingError`. `scriptedApprovals(answers)` answers approval requests in order through `blockingApprovals()`, `scriptedMcpServer()` lends namespaced third-party tools with scripted results, and `testSigner()` and `TEST_KEY_ID` re-export the safety package's fixed-key test signer. `ScriptedModel` also plays a `StreamScript`, a list of recorded events, exactly as recorded.

### Patch Changes

- Updated dependencies [46f4a9c]
  - @buildanagent/gateway@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- e58c676: `SafetyErrorCode` gains `invalid_effect`, the code a guarded write's scope, business key or options throw when they break a rule. The SDK never throws it yet, but a `switch` over every code now needs a case for it.
- Updated dependencies [adddc21]
  - @buildanagent/gateway@0.1.0-alpha.11

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
