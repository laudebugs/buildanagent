---
"@buildanagent/sdk": minor
---

Breaking Changes: every `retry` event now carries a required `layer`, `"gateway"` for an HTTP request the model re-sends and `"turn"` for a model call the loop re-issues. Code that builds a `retry` event, such as a test fixture, must add it; code that reads one is unaffected. `run()` and `continueRun()` gain `turnRetries` (default 0, so a failure still ends the run `error`), `turnRetryDelayMs` and `sleep`: with `turnRetries` set, the loop calls the model again after a call that ended with a `retryable` error, such as a stream cut off after output began. Every attempt is its own step and counts against `maxSteps`. A failed attempt's usage and cost count in the result and the budget.
