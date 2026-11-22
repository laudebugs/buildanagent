---
"@buildanagent/sdk": minor
---

`beforeModelCall` can now return `{ stop: "reason" }`, which ends the run before that call, the first one included. Nothing is sent to the model, no `model_call_start` event is emitted, and the run ends `stopped` with the reason as `stoppedBy`. `composeInterceptors()` ends the check at the first stop. The new `before_model_call_stop_v1` capability marks it.
