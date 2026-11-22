---
"@buildanagent/gateway": minor
---

Breaking Changes: a message whose role is not `user`, `assistant` or `tool`, such as a `system` message cast into a transcript, used to be dropped silently by `transformMessages()`. It now makes `transformMessages()` throw a `GatewayError` with the new code `invalid_message`, and a model from `createModel()` throws the same error from `stream()` before any request is sent. `GatewayErrorCode` gains `invalid_message`, so a `switch` over it that must stay exhaustive needs a new case. Put system text in `ModelContext.system`.
