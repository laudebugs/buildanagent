---
"@buildanagent/sdk": minor
---

Breaking Changes: an exhaustive `switch` over any of these needs the new cases.

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
