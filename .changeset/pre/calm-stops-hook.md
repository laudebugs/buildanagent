---
"@buildanagent/sdk": minor
---

Breaking Changes: `beforeModelCall` now returns `ModelCallPatch | ModelCallStop`, and `ModelCallPatch` gains `stop?: never`. Code that calls a hook itself and reads `patch?.system` or `patch?.activeTools` must narrow the result first. A patch that carried a stray `stop` key now ends the run when the key is valid text and throws `invalid_hook_result` when it is not. Remove the key.

`beforeModelCall` can now return `{ stop: "reason" }`, which ends the run before that call, the first one included. Nothing is sent to the model, no `model_call_start` event is emitted, and the run ends `stopped` with the reason as `stoppedBy`. `composeInterceptors()` ends the check at the first stop. A program versioned apart from the SDK can check for the new `before_model_call_stop_v1` capability before it relies on a stop.
