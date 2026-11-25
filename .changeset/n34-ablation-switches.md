---
"@buildanagent/harness": minor
---

Add `@buildanagent/harness/ablation` (`AblationConfig`, `DEFAULT_ABLATION`, `defaultAblation()`, `validateAblation()`, `ablationHash()`, `credentialEnvOf()`) and wire `HarnessOptions.ablation` into `createHarness()` and `runTurn()` so every removable component can be switched off and its configuration hash stamped into `session_header.ablationHash`.
