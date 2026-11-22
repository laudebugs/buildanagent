---
"@buildanagent/gateway": minor
---

Breaking Changes: `transformMessages()` now throws a `GatewayError` with the new code `invalid_message` for a message whose role is not `user`, `assistant` or `tool`, such as a `system` message cast into a transcript. It used to drop that message silently. A model from `createModel()` throws the same error from `stream()` before it sends any request. `GatewayErrorCode` gains `invalid_message`, so a `switch` over it that must stay exhaustive needs a new case. Put system text in `ModelContext.system`.
