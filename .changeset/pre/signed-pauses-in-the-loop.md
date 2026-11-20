---
"@buildanagent/sdk": minor
---

Breaking Changes: a `beforeToolCall` gate that returns `ask` now pauses its call instead of blocking it. The run ends with the new stop reason `awaiting_approval`, whose `AwaitingApprovalResult` carries `pending`, one signed `SignedPendingRequest` per waiting call; `context.pending` holds the same requests, `context.pendingInputs` holds the input each one signs (the input the call would run with, after coercion, `repair` and any gate's replacement), and the new `approval_request` event reports each request with that input. An `ask` may carry an `input`, and `composeInterceptors()` passes an earlier gate's replacement on that way when a later gate asks.

`idGenerator` now also makes request ids; one that repeats the run's id or an earlier request's id is replaced by a random UUID. A `switch` over `RunResult["stopReason"]` or `AgentEvent["type"]` that was exhaustive needs a case for each, and code that relied on `ask` blocking the call must now handle the pause. `continueRun()` throws `invalid_run_options` for a context with pending requests until it can resume them.

New: the `signer` run option (default `ephemeralSigner()`), `createPendingRequest()`, which signs the same record outside a run, and re-exports of `ApprovalSigner`, `ephemeralSigner()`, `hmacSigner()`, `canonicalInputHash()`, `SignedPendingRequest`, `Resolution`, `SignPendingOptions`, `SafetyError` and `isSafetyError()` from the safety package, unchanged.
