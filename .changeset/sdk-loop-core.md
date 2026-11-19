---
"@buildanagent/sdk": minor
"@buildanagent/gateway": minor
---

Run your agent with `run()`. The loop sends your system prompt and the user's message to the model, runs each tool the model calls, one at a time and in order, and sends the results back until the model answers without calling a tool.

- **Stop reasons, not exceptions.** A run ends with a result whose `stopReason` is `done`, `max_steps`, `error` or `aborted`. `maxSteps` counts model calls and defaults to 20; reaching it emits a `warning` event with `code: "max_steps"`. An `error` result copies the failed call's `kind`, such as `overflow`, with its message and HTTP status. Only the `done` result carries `output`, so TypeScript rejects `result.output` until you have checked the stop reason. Every result carries the summed `usage` and `cost`, the messages the run added, and a `context` to continue from.
- **Output tools end the run.** Pass an `outputTool()` as `output`: once the model calls it with input that passes the schema, the run ends `done` with the validated answer as `result.output`. A call that fails the schema spends one model call.
- **`runOrThrow()` and `continueRun()`.** `runOrThrow(run)` returns a `done` result and throws a `RunStoppedError`, carrying the result and its context, for any other. `RunStoppedError.isInstance()` recognises it. `continueRun(context, options)` goes on from a stored context.
- **Aborts leave a well-formed transcript.** `run.abort()` or the `signal` option stops the run. Every tool call keeps a result, calls that hadn't started get an error result, and the last message is an assistant message with `stopReason: "aborted"`.
- **One closed set of events.** Iterating a run streams its events from the first one: `run_start`, the step and model-call events, the text, reasoning and tool-input deltas, the tool-call events, `retry`, `warning`, `error`, `abort`, `agent_settled` and `run_end`. `AGENT_EVENT_TYPES` lists every type, and a run emits no other.
- **Tool exposure.** A tool whose `exposure` is `"deferred"` or `"hidden"` is not sent to the model.
- **Errors you can recognise by code.** `SdkError` gains the codes `invalid_run_options`, `invalid_model_stream`, `run_stopped` and `unexpected_model_call`; `UnexpectedModelCallError` is now an `SdkError`. In the gateway, `StreamContractError` and `ModelRequestsDisabledError` are now `GatewayError`s, with the codes `stream_contract` and `model_requests_disabled`, so `isGatewayError()` returns true for them. The gateway also exports `addCost()`, which adds two costs by the rule a retried call's cost already follows.
