---
"@buildanagent/sdk": minor
---

Breaking Changes: a step's tool calls now start together instead of one at a time. A tool that relied on running after the calls before it must set `executionMode: "sequential"`, which runs its whole step in the model's order. Two other changes reach every run. The run emits `tool_call_start` for all of a step's calls before the first one executes. `ToolFailure`'s `not_run` kind has a new `reason`, `"sibling_failed"`, so an exhaustive `switch` over it needs a case.

When the model calls several tools in one response, the run checks each call in order, then starts them all at once and adds their results to the transcript in the model's order, whichever finishes first. New settings on `defineTool()`:

- **`executionMode: "sequential"`** makes every call in that step run one at a time, in order.
- **`resourceKey(input)`** names what a call touches, such as a file path. Calls with the same key never overlap and run in the model's order, even across tools.
- **`firstParty` and `annotations.readOnlyHint`**: a first-party tool marked read-only, with no `effect`, lets its calls that share a key run together. The hint of a tool that isn't first party, such as an MCP tool, never changes scheduling.

`ctx.signal` now also fires when a sibling call in the same step throws a programmer error (an `SdkError`), and a call still waiting for its key then gets an error result instead of running. A sibling's error result, such as invalid input or a tool that threw, cancels nothing. `defineTool()` throws `invalid_tool_definition` for an `executionMode` that isn't `"parallel"` or `"sequential"` and for a `resourceKey` that isn't a function, and a call whose `resourceKey` throws or returns a non-string throws the same error. The new types `ToolAnnotations` and `ToolExecutionMode` are exported.
