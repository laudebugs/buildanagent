---
"@buildanagent/sdk": minor
---

Breaking Changes: `beforeModelCall` now returns `ModelCallPatch | ModelCallStop`, and `ModelCallPatch` gains `stop?: never`. Code that calls a hook itself and reads `patch?.system` or `patch?.activeTools` must narrow first, and a patch that carried a stray `stop` key now ends the run or throws `invalid_hook_result`; remove the key.

`beforeModelCall` can now return `{ stop: "reason" }`, which ends the run before that call, the first one included. Nothing is sent to the model, no `model_call_start` event is emitted, and the run ends `stopped` with the reason as `stoppedBy`. `composeInterceptors()` ends the check at the first stop. The new `before_model_call_stop_v1` capability marks it.
