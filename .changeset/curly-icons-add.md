---
"@buildanagent/sdk": patch
---

Add parentRun to RunOptions, set by nestedRunDepth(), so run_start carries parentRunId and parentCallId and otelObserver() parents a nested run's invoke_agent span under the calling execute_tool span
