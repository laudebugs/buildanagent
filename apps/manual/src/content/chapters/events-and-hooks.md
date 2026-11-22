---
title: "Events and hooks: one event union, interceptors and observers"
summary: A run can show what happens inside it and let your code change it, and the two jobs need different surfaces. This chapter shows how an SDK should stream one closed set of events that only describes the run, where it should let code step in, and why observers that only watch belong apart from interceptors that can change a run.
opening: question
sources: [pi-json-events, copilot-streaming-events, buildanagent-sdk-hooks, buildanagent-copilot-sdk-check, langchain-middleware-custom, adk-callback-types, copilot-hooks-overview, pi-extensions, copilot-pre-tool-use-hook, copilot-post-tool-use-hook, adk-plugins, pi-agent-core-readme]
glossary: [delta, interceptor]
switchTo: [B13, B16, B17]
---

Suppose your support agent closes the wrong ticket at 2 a.m. By morning two people want something from you. The on-call engineer asks what the agent did, step by step. The support lead asks whether you can make it stop doing that. The questions sound alike, but they need different powers: seeing a run takes a record of what happened, and changing a run takes a place where your code may step in.

An SDK that blurs the two gives you a logging hook that can also veto a tool call, and a veto that you meant as a log line. Every SDK behind this chapter's listings offers both powers: Copilot has events and hooks, LangChain has streaming and middleware, Google's ADK has the events its runner returns and callbacks, and Pi has subscribers and extension hooks. How should an SDK expose what happens inside a run, and where may outside code change it? We recommend three rules: one closed stream of events describes the run, six named moments let code change it, and observers that only watch stay apart from the interceptors that can change anything.

## A run is one closed stream of events, and each end event carries the finished item

Picture :analogy[a court stenographer]{#court-stenographer} typing every word of a trial as it is spoken. The record is one ordered list, and the lawyer who checks it next year reads the same pages as the judge who followed the trial live. A run's event stream plays that part: one ordered list of what happened, which a progress screen follows live and a session log keeps for later. A stenographer's record is final as typed, and a stream is not, because it also carries partial pieces that a later event supersedes. Two design choices decide whether one stream can serve both readers.

The first choice separates partial from finished. A progress screen wants each piece of text as it arrives, and a log wants the finished message once. Pi's stream shows the split: its `message_update` events carry deltas only, and its docs call `message_end` "the authoritative final message" and tell you to replace what you rebuilt from the deltas with it [@pi-json-events]. The Copilot SDK reaches the same split from the storage side. With streaming on, it emits ephemeral events, the deltas, that are "not persisted to the session log", beside persisted events such as the complete `assistant.message`{checked=row-7} [@copilot-streaming-events]. Our SDK, `@buildanagent/sdk` 0.1.0-alpha.26 as of November 2026, builds the split into two layers [@buildanagent-sdk-hooks]. The delta layer streams each content block by its index, as `text_delta`{checked=row-9} does. The item layer's end events, `model_call_end`{checked=row-9}, `tool_call_end`{checked=row-9} and `run_end`{checked=row-9}, each carry the finished item, so a log stores only those and a replay never meets a half-built message.

:::listing[A Pi subscriber hears the deltas, then the finished message, then the settled marker]{#pi-events file="verify/pi/examples/01-hello-session.ts" region="events"}
::note[One prompt produces the whole run's events: the deltas as `message_update`, the finished message as `message_end`, and a last event that closes the run.]{#prompt}
:::

[[lst:pi-events]] shows the stream from a subscriber's side. The subscriber only appends each event's type to a list, and the example's checks then confirm that the deltas arrived as `message_update`, the finished message as `message_end`, and that `agent_settled` came last. A stream needs its own marker for the end of the whole run, and Pi's docs say why: `agent_end`{checked=row-11} closes one low-level run, and a retry or a queued message can still continue it, while `agent_settled` means Pi has no automatic work left [@pi-json-events]. Ours has the same marker, `agent_settled`, which fires once nothing is running any more, and `run_end`{checked=row-13} follows it with the result [@buildanagent-sdk-hooks].

The second choice is to close the list. A UI or a log switches on each event's `type`{checked=row-17}, and TypeScript can check that every case is handled only if the union names every event the runtime can emit. The Copilot SDK's docs say its `SessionEvent`{checked=row-14} union lists "every event the runtime can emit" [@copilot-streaming-events]. In our check of version 1.0.31, a plain turn also emitted ten `model.*` event types that none of the union's 154 members declares, seen with a bring-your-own-key provider and our mock model, so a `switch` that TypeScript counted as exhaustive met values it had no case for [@buildanagent-copilot-sdk-check]. Our SDK tests the promise instead of only stating it. `AGENT_EVENT_TYPES`{checked=row-18} lists every type of the union, and a test fails when a run emits a type that list lacks [@buildanagent-sdk-hooks].

One closed, two-layer stream gives the engineer in the opening a record to read: the deltas for a live screen, the end events for the log. It leaves the support lead's question open, because a stream only describes. Where may your code step in?

## Six interceptors let code change a run at the model and the tool

Think of :analogy[toll booths]{#toll-booths} on a road. Each booth stands at a fixed place, every car stops at it, and the attendant can wave the car through, charge it or turn it back. An interceptor is a booth in the loop: a function that the SDK calls at a fixed moment, which can let a model call or a tool call pass, change it or end it. The comparison fails in one place, because an interceptor can rewrite the request itself, as if the attendant swapped the driver's destination. [[fig:toll-booths]] draws the booth with a camera beside the road, which is the observer of the next section.

:::figure[Toll booths that can stop, charge or turn back a car, and a camera that only records]{#toll-booths analogy="toll-booths"}
::svg{alt="A car, labelled the request, drives right into a toll booth that can wave the car through, charge it or turn it back, and on to the road beyond. A dashed arrow leads from the booth down to a traffic camera that records every car and stops none, and an arrow leads from the camera to a box called the record."}
:::

Our SDK, as of November 2026, has six interceptors named by moment, and a step calls them in one fixed order [@buildanagent-sdk-hooks]. `transformContext`{checked=row-19} returns the messages to send, `beforeModelCall`{checked=row-19} changes the request or ends the run before it, `afterModelCall`{checked=row-19} replaces the response, `beforeToolCall`{checked=row-19} gates each tool call, `afterToolCall`{checked=row-19} edits each result, and `shouldStop`{checked=row-19} ends the run or keeps it going. [[fig:six-moments]] puts the six on one timeline, with the events that an observer hears beside them.

:::figure[One step of our SDK calls its six interceptors in a fixed order, and an observer hears the events beside them]{#six-moments}
::svg{alt="Two columns. On the left, eight boxes joined by downward arrows in the order transformContext, beforeModelCall, the model call, afterModelCall, beforeToolCall, the tool runs, afterToolCall and shouldStop; the six interceptors are outlined in the accent colour and the model call and the tool run are dashed. On the right, a dashed lane headed observers: only watch. Dashed arrows lead from five boxes into the lane, to the events context_transformed, model_call_start, model_call_end, tool_call_end and step_end. A note in the lane says no arrow points back, because an observer returns nothing the run reads."}
:::

The other SDKs agree on the moments and differ in how many they offer. LangChain's middleware has six hooks, four that run at fixed points and two that wrap a model call or a tool call [@langchain-middleware-custom]. ADK's callbacks come in before and after pairs for the agent, the model and the tool [@adk-callback-types]. Copilot's hook table lists twelve, from `onPreToolUse` to `onSubagentStop`{checked=row-23} [@copilot-hooks-overview]. Pi names the two tool moments `tool_call`{checked=row-24}, which can block a call or change its input, and `tool_result`{checked=row-24}, which can modify the result [@pi-extensions]. The counts differ, but every SDK lets code in right before and right after a tool call, and the three listings below stand at that moment.

::::tabs
:::listing[Copilot SDK]{#block-copilot file="verify/copilot-sdk/examples/08-hooks.ts" region="hooks" replay}
::note[Returning a decision of `deny` blocks the call, and the example's checks confirm that the model reads the reason.]{#deny}
::note[Returning `null` lets the call through unchanged. The docs return `null` here, and the types say `void`.]{#pass}
::note[`modifiedResult` replaces what the model reads, so the raw ticket body never reaches it.]{#replace}
:::
:::listing[LangChain]{#block-langchain file="verify/langchain/examples/07-middleware.ts" region="middleware"}
::note[A hook that returns `undefined` changes nothing. This one only records that it ran.]{#observe}
::note[The tool never runs. The middleware answers with its own `ToolMessage`, which the model reads.]{#block}
::note[Calling `handler` runs the tool, and what it returns is the call's result.]{#through}
:::
:::listing[Google ADK]{#block-adk file="verify/google-adk/examples/05-callbacks.ts" region="tool-callbacks"}
::note[Returning an object skips the tool, and the object is the result the model reads. Returning `undefined` lets the tool run.]{#block}
::note[Returning an object replaces the tool's result.]{#after}
:::
::::

All three hooks decide what happens to one call, and each returns a different shape. Copilot's returns a decision object whose `deny` carries the reason; LangChain's wrap hook receives `handler` and blocks by not calling it; ADK's returns an object that stands in for the result [@copilot-pre-tool-use-hook; @langchain-middleware-custom; @adk-callback-types]. The after moment works the same way, since Copilot's `modifiedResult` and ADK's returned object each replace the tool's result before the model reads it [@copilot-post-tool-use-hook; @adk-callback-types]. Copilot's hook also runs ahead of its permission callback, and the example's checks confirm that the callback never hears about the denied call. In every case a hook that returns nothing lets the call go on, and a hook that returns a value replaces the step.

That convention has a cost: a forgotten return is permission. Copilot's docs tell you to return a decision every time, even though `null` allows the tool [@copilot-pre-tool-use-hook], and ADK's Python docs warn that only `None`{checked=row-32} lets the tool run, so an empty `dict`{checked=row-32} skips it [@adk-callback-types]. Our SDK removes the ambiguity for gates. A `beforeToolCall`{checked=row-19} that returns nothing throws an error with the code `invalid_hook_result`{checked=row-33}, so a missing `return` cannot pass for permission. It also freezes each event's data, so a hook that tries to change its input throws, and the hook returns a replacement instead [@buildanagent-sdk-hooks].

Where a change lands decides whether it is a view or the record. In our SDK, what `transformContext`{checked=row-19} and `beforeModelCall`{checked=row-19} return reaches that one request, and the transcript keeps its own messages. What `afterModelCall`{checked=row-19} and `afterToolCall`{checked=row-19} return becomes the record: the transcript, `model_call_end`{checked=row-36} and `tool_call_end`{checked=row-36} hold the replacement, and the model reads it [@buildanagent-sdk-hooks]. A request's events also show what was really sent, because `model_call_start`{checked=row-37} carries the request after both hooks have run. A redaction therefore leaves one trace. The audit sees the redacted result that the model saw, and nobody finds the original in the log.

A real agent joins several policies, such as a context policy, a permission check and an audit, so the way an SDK combines hooks for one moment decides whether their order matters. [[tbl:combine-hooks]] shows each SDK's rule.

:::table[How each SDK combines several hooks for one moment]{#combine-hooks}
| SDK | Several hooks for one moment |
| --- | --- |
| Copilot | One function per hook name; the docs describe no way to join several [@copilot-hooks-overview] |
| LangChain | A list of middleware: before hooks run in list order, wrap hooks nest like function calls, after hooks run in reverse order [@langchain-middleware-custom] |
| ADK (Python) | A list per callback, run in order until one returns a result; a Plugin's hook runs before the agent's callback and skips it when it returns a value [@adk-callback-types; @adk-plugins] |
| Pi | Handlers run in load order, and some chain the value an earlier handler returned; a blocked call stops that operation's normal path [@pi-extensions] |
| Our SDK | `composeInterceptors()`{checked=row-42} merges patches in order, lets the strictest gate answer win and lets the first stop win [@buildanagent-sdk-hooks] |
:::

Order decides the outcome wherever the first hook that answers ends the chain. In ADK's list, a guard placed after a caching callback never runs when the cache answers. Our join makes the order of gates irrelevant to the verdict: the first `deny` ends the check, and an `ask`{checked=row-42} outranks an `allow`{checked=row-42} [@buildanagent-sdk-hooks].

A hook is also code that can throw, and a throw at a gate must not mean yes. Pi's docs say gate handlers should fail closed when their safety decision cannot be made [@pi-extensions]. Our SDK's default does so. A failed gate denies its call, a failed `afterToolCall`{checked=row-19} withholds the result so that a redaction that crashed cannot leak the original, and a failed model-moment hook ends the run with the stop reason `error`{checked=row-45}; setting `onFailure`{checked=row-45} to `"continue"` skips a failed hook instead [@buildanagent-sdk-hooks].

Do not use a pair of hooks for bookkeeping. Copilot's docs say that a pre-hook does not guarantee a matching post-hook, because the post hooks fire only after a success or a failure result [@copilot-hooks-overview]. Our `afterToolCall`{checked=row-19} likewise skips a call that never ran, such as a denied call, an unknown tool or invalid input. The `tool_call_end`{checked=row-36} event still reports a denied call, with an error result that names the reason, and Pi's `tool_execution_end`{checked=row-48} does the same for every finalized call, a blocked one included [@pi-extensions]. Hooks decide, and events record what was decided.

Interceptors are written before a run starts, but sometimes a person must change a run that is already underway. [[lst:pi-steer]] shows Pi's answer: a second `prompt()` while the run streams is rejected, so the person queues a steer for the current run or a follow-up for after it.

:::listing[Pi accepts a steer and a follow-up while a run streams, and rejects a plain second prompt]{#pi-steer file="verify/pi/examples/04-steering.ts" region="steer"}
::note[The first prompt is still streaming when the next calls arrive.]{#start}
::note[A plain `prompt()` is rejected during a run, so a second message cannot slip in by accident.]{#reject}
::note[`steer()` queues a message for the run in progress and answers `"queued"`.]{#steer}
::note[`followUp()` queues a message for after the run would otherwise end.]{#follow-up}
:::

Pi's docs say a steer waits until the current assistant message's tool calls have finished and is then read on the next turn, and a follow-up waits until there are no tool calls and no steers left [@pi-agent-core-readme]. Our SDK follows the same boundary rule: `run.steer()`{checked=row-51} is applied before the run's next model call, and `run.followUp()`{checked=row-51} waits until the run would otherwise end. Each returns a receipt, and the run emits a `steer_applied`{checked=row-51} event for it, so the outside change is itself in the record [@buildanagent-sdk-hooks].

Six moments, a return value that replaces, a default that fails closed and a record kept by events give code the power to change a run without hiding that it did. The remaining question is what code should do when it only needs to watch.

## Exercises

1. **Read the stream's last event.** In `verify/pi/examples/01-hello-session.ts`, print `events` after the prompt returns. Which event comes last, and which event closes the model's message? Say which one a log should treat as the end of the run, and why the other would be the wrong choice.
