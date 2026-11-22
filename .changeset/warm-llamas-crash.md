---
"@buildanagent/sdk": minor
---

Breaking Changes: `ToolContext` now has an `app` field, so a `ToolContext` you build by hand in a test needs one. The field comes from a new `app` option on `run()` and `continueRun()`, and `ToolDefinition` and `defineTool()` take a third type parameter for its type. The caller sets `app` when a run starts, each tool reads it as `ctx.app`, and the model never sees it. A run whose tools declare its type must pass it.
