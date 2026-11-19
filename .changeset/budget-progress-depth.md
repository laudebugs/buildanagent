---
"@buildanagent/sdk": minor
---

Breaking Changes: `RunResult` has a new `budget` variant and `RunError.kind` a new `unknown_price` value, so an exhaustive `switch` over either stops compiling until it handles the new case. Every run now also ends `no_progress` after 3 identical failing tool calls in a row; pass `progress: false` to turn that off.

New: `run()` takes `budgetUsd`. Before each call it projects the cost with `projectCallCost()` (now re-exported) and, if the call could pass the cap, ends the run `budget` without making it. A budgeted run on a model with no price ends with `error.kind: "unknown_price"` before its first call.

New: a tool can declare `progressKey()`, and 5 calls with one key and no success end the run `no_progress`. `progress` changes both thresholds.

New: `depth` and `maxDepth` set the nesting that tools read from `ctx`. `run()` throws `max_depth_exceeded` for a run nested past the cap, and `nestedRunDepth(ctx)` gives a spawning tool the options for its child run.
