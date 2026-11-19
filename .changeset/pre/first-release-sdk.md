---
"@buildanagent/sdk": minor
---

First public release, holding the testing export; the agent loop comes in a later release.

- **`ScriptedModel`.** Plays back scripted responses, one per model call, and fails a test whose calls drift from the script: a call past the last step throws `UnexpectedModelCallError`, and `assertComplete()` throws if a step was never used.
- **Deterministic helpers.** `fixedClock()` and `sequentialIds()` give the same clock readings and ids on every run.
