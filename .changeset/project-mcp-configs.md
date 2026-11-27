---
"@buildanagent/harness": minor
---

Add `loadProjectMcpServers()` and `pinProjectMcpServer()` to `@buildanagent/harness/extensions/node`: a project's `.mcp.json` starts stdio servers only in a trusted project, and only when each server's config matches its content-hash pin in `.agents/extensions.lock.json`. Credentials are `${NAME}` references that the host resolves, never values in the file.
