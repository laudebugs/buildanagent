---
"@buildanagent/sdk": minor
---

Breaking Changes: `RunResult` has a new `budget` variant and `RunError.kind` a new `unknown_price` value, so an exhaustive `switch` over either stops compiling until it handles them, and every run now ends `no_progress` after 3 identical failing tool calls in a row; pass `progress: false` to turn that off. New: `run()` takes `budgetUsd`, which projects each call's cost with `projectCallCost()` (now re-exported) and ends the run `budget` before a call that could pass the cap, and refuses a budgeted run on a model with no price with `error.kind: "unknown_price"` before its first call. A tool can declare `progressKey()`, and 5 calls with one key and no success end the run `no_progress`; `progress` changes both thresholds. `depth` and `maxDepth` set the nesting that tools read from `ctx`, `run()` throws `max_depth_exceeded` for a run nested past the cap, and `nestedRunDepth(ctx)` gives a spawning tool the options for its child run.
