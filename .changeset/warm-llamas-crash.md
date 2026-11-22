---
"@buildanagent/sdk": minor
---

Breaking Changes: ToolContext now has an app field, so a ToolContext you build by hand in a test needs one. Add app to RunOptions and a third type parameter to ToolDefinition and defineTool(): the caller sets app when a run starts, and each tool reads it as ctx.app. The model never sees it, and a run whose tools declare its type must pass it.
