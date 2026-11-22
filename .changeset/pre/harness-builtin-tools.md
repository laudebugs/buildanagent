---
"@buildanagent/harness": minor
---

Add the built-in tools. `builtinTools(sandbox, proxy, { root, policy, env?, spills? })` from `@buildanagent/harness/tools` returns `read`, `write`, `edit`, `bash`, `grep`, `glob` and, when a proxy is given, `fetch`. Every path is checked against the sandbox policy's roots before a sandbox call, `bash` and the search tools run only inside the sandbox, and `fetch` goes only through the egress proxy and scrubs known secrets from what it returns. `read` pages long files and long lines and can open the full text of a cut result by its spill path. `ExecResult` gains an optional `timedOut` flag that every sandbox backend sets when it stops a command for time, and `fakeSandbox()` understands `find`, `grep` and `bash -c`. `memorySpillStore()` now returns absolute paths, and `fileSpillStore()` gains `read(key, path)`.
