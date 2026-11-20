---
"@buildanagent/sdk": patch
---

Fix ScriptedModel cloning a scripted tool_call's input only when it also generates a callId, so mutating an emitted input no longer corrupts the script or later runs of the same step
