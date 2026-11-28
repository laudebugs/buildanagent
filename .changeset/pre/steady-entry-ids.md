---
"@buildanagent/harness": patch
---

Fix session logs that differed between stores for the same run. The entry writer now takes each entry's id and timestamp when the write is queued, not after the store finishes its earlier appends, so a fixed clock and id generator give the same log on every store. An id generator or clock that throws now stops the run, as a failed store write does.
