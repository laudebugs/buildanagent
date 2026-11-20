---
"@buildanagent/sdk": minor
"@buildanagent/gateway": minor
---

`run_start` now carries a real `defaultsHash` and `capabilities` instead of the reserved empty values. The SDK exports both: `DEFAULTS_HASH`, a SHA-256 over every default value, built-in prompt and tool description the SDK uses, and `CAPABILITIES`, the eleven behaviours this release supports, such as `steering_v1`. A future change to a default changes the hash and is named in the changelog. Both packages now ship an `llms.txt` that indexes the README and lists every public export. The gateway README's `assertStreamContract()` example now passes `model.ref`, as `ModelAdapter.stream()` requires. No default, prompt or tool text changed.
