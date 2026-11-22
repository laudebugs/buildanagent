---
"@buildanagent/sdk": patch
---

Add `parentRun` to `RunOptions`, which `nestedRunDepth()` sets. A nested run's `run_start` now carries `parentRunId` and `parentCallId`, and `otelObserver()` places the run's span under the calling tool's span.
