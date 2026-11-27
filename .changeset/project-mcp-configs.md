---
"@buildanagent/harness": minor
---

Add `loadProjectMcpServers()` and `pinProjectMcpServer()` to `@buildanagent/harness/extensions/node`: a project's `.mcp.json` starts stdio servers only in a trusted project, each pinned by content hash in `.agents/extensions.lock.json`, with credentials named as `${NAME}` references the host resolves and never as values.
