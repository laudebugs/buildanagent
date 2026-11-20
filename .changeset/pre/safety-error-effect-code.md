---
"@buildanagent/sdk": patch
---

`SafetyErrorCode` gains `invalid_effect`, the code a guarded write's scope, business key or options throw when they break a rule. The SDK never throws it yet, but a `switch` over every code now needs a case for it.
