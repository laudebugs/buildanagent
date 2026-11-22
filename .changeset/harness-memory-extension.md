---
"@buildanagent/harness": minor
---

Add long-term memory to the harness as a removable extension.

- `memoryExtension()` from the new `@buildanagent/harness/memory` entry adds a `memory` tool (`view`, `create`, `str_replace`, `delete`, `rename`) over `.agents/memory/` only. Each record is one sourced Markdown file, and the index at the start of each run's first request stops at 200 lines or 25 KiB.
- Records expire from an injected clock. A write after untrusted tool output is stored as low trust, and no write raises a record's trust.
- The extension denies the built-in `write` and `edit` tools inside the folder.
- `fileMemoryFiles()` from `@buildanagent/harness/memory/node` keeps the folder on disk and follows no links.
- A delete adds the calls that held the record to a purge list, which a mark matches by run where the log shows one.
- `purgeSession()` from `@buildanagent/harness/session` rewrites a session with those calls' content removed, keeps each entry's base fields, and returns the `spills` and `residual` entries the caller should handle.
- `pruneSessions({ marks })` takes the purge list, and its result adds `purgedMarks` and `markedArchives`.
- `clearPurgeMarks()` takes an `unmatched` option: marks no session held leave the list once they are 30 days old.
