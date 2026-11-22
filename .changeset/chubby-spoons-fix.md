---
"@buildanagent/gateway": patch
---

A message whose role was cast to `system` now makes `transformMessages()` throw a `GatewayError` with code `invalid_message` instead of silently dropping it. Put system text in `ModelContext.system`.
