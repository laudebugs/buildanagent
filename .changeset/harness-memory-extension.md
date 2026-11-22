---
"@buildanagent/harness": minor
---

Add long-term memory as a removable extension. `memoryExtension()` from the new `@buildanagent/harness/memory` entry adds a `memory` tool (`view`, `create`, `str_replace`, `delete`, `rename`) over `.agents/memory/` only, with one sourced record per Markdown file, an index capped at 200 lines or 25 KiB at the start of each run's first request, expiry from an injected clock, and low-trust writes after untrusted tool output. `fileMemoryFiles()` from `@buildanagent/harness/memory/node` keeps the folder on disk and follows no links. A delete adds the calls that held the record to a purge list, `purgeSession()` in `@buildanagent/harness/session` rewrites a session with their content removed and each entry's base fields kept, and `pruneSessions()` takes the list as `marks`.
