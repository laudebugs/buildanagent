---
"@buildanagent/sdk": minor
---

`SDK_VERSION` is now exported. It is the string `run_start.sdkVersion` carries, so a host that writes a session's header before the run starts, as the harness does, can stamp the same version.
