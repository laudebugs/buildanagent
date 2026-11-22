---
title: "Events and hooks: one event union, interceptors and observers"
summary: A run can show what happens inside it and let your code change it, and the two jobs need different surfaces. This chapter shows how an SDK should stream one closed set of events that only describes the run, where it should let code step in, and why observers that only watch belong apart from interceptors that can change a run.
opening: question
sources: [pi-json-events, pi-sdk, adk-events, langchain-streaming, copilot-streaming-events, buildanagent-sdk-hooks, buildanagent-copilot-sdk-check, langchain-middleware-custom, adk-callback-types, adk-callbacks-index, copilot-hooks-overview, pi-extensions, copilot-pre-tool-use-hook, copilot-post-tool-use-hook, adk-plugins, pi-agent-core-readme]
glossary: [delta, interceptor, observer]
switchTo: [B13, B16, B17]
---

Who may change a run, and who may only watch it? Suppose your support agent closes the wrong ticket at 2 a.m. By morning two people want something from you. The on-call engineer asks what the agent did, step by step. The support lead asks whether you can make it stop doing that. The questions sound alike, but they need different powers: seeing a run takes a record of what happened, and changing a run takes a place where your code may step in.

An SDK that blurs the two lets a hook that you meant as a log line veto a tool call. Every SDK behind this chapter's listings offers both powers: Copilot has events and hooks, LangChain has streaming and middleware, Google's ADK has the events its runner returns and callbacks, and Pi has subscribers and extension hooks. How should an SDK expose what happens inside a run, and where may outside code change it? We recommend three rules: one closed stream of events describes the run, six named moments let code change it, and observers that only watch stay apart from the interceptors that can change anything.

## A run is one closed stream of events, and each end event carries the finished item

A trial's record has to be right on the day and still right next year. :analogy[A court stenographer]{#court-stenographer} types every word as it is spoken, so the lawyer who checks the pages later reads what the judge followed live. A run's event stream plays that part: one ordered list of what happened, which a progress screen follows live and a session log keeps for later. The likeness stops at one point. A stenographer's record is final as typed, and a stream is not, because it also carries partial pieces that a later event supersedes. Two design choices decide whether one stream can serve both readers.

The first choice separates partial from finished. A progress screen wants each piece of text as it arrives, and a log wants the finished message once. Pi's stream shows the split: its `message_update` events carry deltas only, and its docs call `message_end` "the authoritative final message" and tell you to replace what you rebuilt from the deltas with it [@pi-json-events]. The Copilot SDK reaches the same split from the storage side. With streaming on, it emits ephemeral events, the deltas, that are "not persisted to the session log", beside persisted events such as the complete `assistant.message`{checked=row-7} [@copilot-streaming-events].

Our SDK, `@buildanagent/sdk` 0.1.0-alpha.26 as of November 2026, builds the split into two layers [@buildanagent-sdk-hooks]. The delta layer streams each content block by its index, as `text_delta`{checked=row-9} does. The item layer's end events, `model_call_end`{checked=row-9}, `tool_call_end`{checked=row-9} and `run_end`{checked=row-9}, each carry the finished item, so your log stores only those and a replay never meets a half-built message. In the 2 a.m. case, the engineer's step list is a run of those end events: a `tool_call_end`{checked=row-9} for each tool call, the ticket close included, and a `run_end`{checked=row-9} after the last. A live screen at that hour would have shown the deltas, and the log never needed them.

:::listing[A Pi subscriber hears the deltas, then the finished message, then the settled marker]{#pi-events file="verify/pi/examples/01-hello-session.ts" region="events"}
::note[One prompt produces the whole run's events: the deltas as `message_update`, the finished message as `message_end`, and a last event that closes the run.]{#prompt}
:::

[[lst:pi-events]] shows the stream from a subscriber's side. The subscriber only appends each event's type to a list, and the example's checks then confirm that the deltas arrived as `message_update`, the finished message as `message_end`, and that `agent_settled` came last. A stream needs its own marker for the end of the whole run, and Pi's docs say why: `agent_end`{checked=row-11} closes one low-level run, and a retry or a queued message can still continue it, while `agent_settled` means Pi has no automatic work left [@pi-json-events]. The SDK's own stream ends the same way: `agent_settled` fires once nothing is running any more, and `run_end`{checked=row-13} follows it with the result [@buildanagent-sdk-hooks].

The second choice is to close the list. Your UI or log switches on each event's `type`{checked=row-17}, and TypeScript can check that every case is handled only if the union names every event the runtime can emit. The Copilot SDK's docs say its `SessionEvent`{checked=row-14} union lists "every event the runtime can emit" [@copilot-streaming-events]. In our check of version 1.0.31 as of November 2026, a plain turn also emitted ten `model.*` event types that none of the union's 154 members declares, seen with a bring-your-own-key provider and our mock model. A `switch` that TypeScript counted as exhaustive therefore met values you had written no case for [@buildanagent-copilot-sdk-check].

We test that promise instead of only stating it. `AGENT_EVENT_TYPES`{checked=row-18} lists every type of the union, and a test fails when a run emits a type that list lacks [@buildanagent-sdk-hooks].

The stream answers the engineer. The support lead's question stays open: where may your code step in?

## Six interceptors let code change a run at the model and the tool

Where can your code get a say in a run? At fixed places, as at :analogy[a toll booth]{#toll-booths}, where every car stops and the attendant can wave it through, charge it or turn it back. A booth leaves the car as it is, but an interceptor can rewrite the request itself, as if the attendant swapped the driver's destination. In every other way the likeness holds: an interceptor is a booth in the loop, a function that the SDK calls at a fixed moment, which can let a model call or a tool call pass, change it or end it. [[fig:toll-booths]] draws the booth with a camera beside the road, which is the observer of the next section.

:::figure[Toll booths that can stop, charge or turn back a car, and a camera that only records]{#toll-booths analogy="toll-booths"}
::svg{alt="A car, labelled the request, drives right into a toll booth that can wave the car through, charge it or turn it back, and on to the road beyond. A dashed arrow leads from the booth down to a traffic camera that records every car and stops none, and an arrow leads from the camera to a box called the record."}
:::

As of November 2026, our SDK has six interceptors named by moment, and a step calls them in one fixed order [@buildanagent-sdk-hooks]. `transformContext`{checked=row-19} returns the messages to send, `beforeModelCall`{checked=row-19} changes the request or ends the run before it, `afterModelCall`{checked=row-19} replaces the response, `beforeToolCall`{checked=row-19} gates each tool call, `afterToolCall`{checked=row-19} edits each result, and `shouldStop`{checked=row-19} ends the run or keeps it going. [[fig:six-moments]] puts the six on one timeline, with the events that an observer hears beside them.

:::figure[One step of our SDK calls its six interceptors in a fixed order, and an observer hears the events beside them]{#six-moments}
::svg{alt="Two columns. On the left, eight boxes joined by downward arrows in the order transformContext, beforeModelCall, the model call, afterModelCall, beforeToolCall, the tool runs, afterToolCall and shouldStop; the six interceptors are outlined in the accent colour and the model call and the tool run are dashed. On the right, a dashed lane headed observers: only watch. Dashed arrows lead from five boxes into the lane, to the events context_transformed, model_call_start, model_call_end, tool_call_end and step_end. A note in the lane says no arrow points back, because an observer returns nothing the run reads."}
:::

The other SDKs agree on the moments and differ in how many they offer. LangChain's middleware has six hooks, four that run at fixed points and two that wrap a model call or a tool call [@langchain-middleware-custom]. ADK's callbacks come in before and after pairs for the agent, the model and the tool [@adk-callback-types]. Copilot's hook table lists twelve, from `onPreToolUse` to `onSubagentStop`{checked=row-23} [@copilot-hooks-overview]. Pi names the two tool moments `tool_call`{checked=row-24}, which can block a call or change its input, and `tool_result`{checked=row-24}, which can modify the result [@pi-extensions]. The counts differ, but every SDK lets code in right before and right after a tool call, and the three listings below all sit at that tool moment.

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

All three hooks decide what happens to one call, and each returns a different shape. Copilot's returns a decision object whose `deny` carries the reason; LangChain's wrap hook receives `handler` and blocks by not calling it; ADK's returns an object that stands in for the result [@copilot-pre-tool-use-hook; @langchain-middleware-custom; @adk-callback-types]. The after moment works the same way, since Copilot's `modifiedResult` and ADK's returned object each replace the tool's result before the model reads it [@copilot-post-tool-use-hook; @adk-callback-types]. Copilot's hook also runs ahead of its permission callback, and the example's checks confirm that the callback never hears about the denied call.

What a hook returns means something different in each SDK. In Copilot, a hook that returns nothing lets the call go on, and a returned decision can deny the call or edit its arguments, while an `allow`{checked=row-74} changes nothing. In ADK, returning nothing also lets the call go on, and a returned object replaces the step. LangChain's wrap hook has no such default, because the tool runs only if the hook calls `handler`.

That convention has a cost: a `return` you forget is permission. Copilot's docs tell you to return a decision every time, even though `null` allows the tool [@copilot-pre-tool-use-hook], and ADK's Python docs warn that only `None`{checked=row-32} lets the tool run, so an empty `dict`{checked=row-32} skips it [@adk-callback-types]. We closed that gap for gates.

A `beforeToolCall`{checked=row-19} that returns nothing throws an error with the code `invalid_hook_result`{checked=row-33}. A missing `return` therefore cannot pass for permission. The SDK also freezes each event's data, so a hook that tries to change its input throws, and you return a replacement instead [@buildanagent-sdk-hooks].

Where a change lands decides whether it is a view or the record. What `transformContext`{checked=row-19} and `beforeModelCall`{checked=row-19} return reaches that one request, and the transcript keeps its own messages. What `afterModelCall`{checked=row-19} and `afterToolCall`{checked=row-19} return becomes the record: the transcript, `model_call_end`{checked=row-36} and `tool_call_end`{checked=row-36} hold the replacement, and the model reads it [@buildanagent-sdk-hooks]. A request's events also show what was really sent, because `model_call_start`{checked=row-37} carries the request after both hooks have run. A redaction therefore leaves no copy of the original in the record. The audit sees the redacted result that the model saw.

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

Order decides the outcome wherever the first hook that answers ends the chain. In ADK's list, a guard placed after a caching callback never runs when the cache answers. Our join gives the gates a fixed precedence: a `deny` anywhere ends the check, and an `ask`{checked=row-42} outranks an `allow`{checked=row-42} [@buildanagent-sdk-hooks]. Order still matters in one way, because a gate that replaces the call's input hands the replacement to the gates after it. If one gate rewrites `/etc/passwd` to a safe path and allows it, and another denies every `/etc` path, the first-then-second order allows the call and the reverse order denies it.

A hook is also code that can throw, and a throw at a gate must not mean yes. Pi's docs say gate handlers should fail closed when their safety decision cannot be made [@pi-extensions]. We default to that rule. A failed gate denies its call, a failed `afterToolCall`{checked=row-19} withholds the result so that a redaction that crashed cannot leak the original, and a failed model-moment hook ends the run with the stop reason `error`{checked=row-45}; setting `onFailure`{checked=row-45} to `"continue"` skips a failed hook instead [@buildanagent-sdk-hooks].

Do not use a pair of hooks for bookkeeping. Copilot's docs say that a pre-hook does not guarantee a matching post-hook, because the post hooks fire only after a success or a failure result [@copilot-hooks-overview]. `afterToolCall`{checked=row-19} likewise skips a call that never ran, such as a denied call, an unknown tool or invalid input. The `tool_call_end`{checked=row-36} event still reports a denied call, with an error result that names the reason, and Pi's `tool_execution_end`{checked=row-48} does the same for every finalized call, a blocked one included [@pi-extensions].

Interceptors are written before a run starts, but sometimes a person must change a run that is already underway. [[lst:pi-steer]] shows Pi's answer: a second `prompt()` while the run streams is rejected, so the person queues a steer for the current run or a follow-up for after it.

:::listing[Pi accepts a steer and a follow-up while a run streams, and rejects a plain second prompt]{#pi-steer file="verify/pi/examples/04-steering.ts" region="steer"}
::note[The first prompt is still streaming when the next calls arrive.]{#start}
::note[A plain `prompt()` is rejected during a run, so a second message cannot slip in by accident.]{#reject}
::note[`steer()` queues a message for the run in progress and answers `"queued"`.]{#steer}
::note[`followUp()` queues a message for after the run would otherwise end.]{#follow-up}
:::

Pi's docs say a steer waits until the current assistant message's tool calls have finished and is then read on the next turn, and a follow-up waits until there are no tool calls and no steers left [@pi-agent-core-readme]. `run.steer()`{checked=row-51} obeys the same boundary rule in our SDK: it is applied before the run's next model call, and `run.followUp()`{checked=row-51} waits until the run would otherwise end. Each returns a receipt, and the run emits a `steer_applied`{checked=row-51} event for it, so the outside change is itself in the record [@buildanagent-sdk-hooks].

What should code do when it only needs to watch?

## Observers only watch, so a failing one can never fail the run

A broken logger should never close the road. :analogy[Traffic cameras]{#traffic-cameras} show the shape: they record every car that passes and stop none. An observer is a camera on the run, a function that the SDK calls with each event, in order, and whose return value the run never reads. A camera that jams still cannot close the road, and that is the second half of the design. An SDK has to isolate its observers, or a logging bug becomes an outage.

Every SDK in this chapter already has a way to watch. Pi has `session.subscribe` [@pi-sdk], Copilot has `session.on`{checked=row-57} [@copilot-streaming-events], ADK's runner returns events [@adk-events], and LangChain streams updates [@langchain-streaming]. The trouble starts where a team watches with a hook instead, because a hook that can change a run cannot be told from one that only looks. Copilot's own logging example sits in `onPreToolUse` and returns `{ permissionDecision: "allow" }` [@copilot-hooks-overview]. ADK lists "Observe & Debug" as the first use of its callbacks, beside "Customize & Control" [@adk-callbacks-index]. LangChain's docs recommend node-style hooks for logging, and [[lst:block-langchain]]'s `beforeModel` only records that it ran [@langchain-middleware-custom]. Pi comes closest to separating them, because its docs mark each event as one that notifies or one that transforms, and say a notification's return value is ignored [@pi-extensions].

The cost shows up the first time a logger is edited. A hook that was meant to log, and that returns a decision or an object, now gates or rewrites. ADK's Python docs give a small case: a before-tool callback that returns an empty `dict`{checked=row-32} skips the tool, so a logger that returns `{}`{checked=row-32} by habit vetoes every call [@adk-callback-types].

In our SDK, watching gets its own type. An `Observer`{checked=row-59} is `(event) => void | Promise<void>`{checked=row-59}, passed in the `observers`{checked=row-59} option, or added with `run.on()`{checked=row-59}, which returns the function that removes it [@buildanagent-sdk-hooks]. Four rules keep it a camera:

1. **Each observer sees every event in order,** and waits for its own promise before it gets the next. Observers do not wait for each other, so a slow one delays only itself.
2. **Each gets a frozen copy of the event,** so it cannot change the run's own data.
3. **A throw or a rejection becomes a `hook_error`{checked=row-62} event** that names the hook as `observer`{checked=row-62}, and the run goes on to its normal end. A failure while handling `run_end`{checked=row-13} is dropped, because nothing may follow that event.
4. **The run waits for observers only twice,** at `agent_settled` and at `run_end`{checked=row-13}, and for at most `observerTimeoutMs`{checked=row-63}, 10 seconds by default. An observer that has not caught up by then is removed and reported.

The fourth rule answers the one place where the camera comparison breaks. A camera cannot close the road, but an observer that never returns can hold a run open, unless the SDK bounds the wait. Pi's docs show the pressure from the other side: listeners of `Agent.subscribe()`{checked=row-65} are awaited, and a run settles only after its awaited `agent_end`{checked=row-65} listeners finish, which suits final work such as flushing a session but leaves a hung listener holding the run [@pi-agent-core-readme]. The same docs say nothing about a listener that throws, so this chapter claims nothing about it for Pi, Copilot, LangChain or ADK.

The best observers are projections of the stream. The SDK's `otelObserver()`{checked=row-67} turns events into OpenTelemetry spans: one `invoke_agent`{checked=row-67} span for the run, one `chat`{checked=row-67} span for each model call and one `execute_tool`{checked=row-67} span for each tool call, sent only to the tracer you pass, with prompts and tool results left out unless you set `captureContent`{checked=row-67} [@buildanagent-sdk-hooks]. It needs no hook into the loop, because the end events already carry the finished items. A tracer that throws is one more `hook_error`{checked=row-62}.

The test for choosing between the two kinds is what the job needs to do to the run. [[tbl:hook-jobs]] sorts seven jobs by that test.

:::table[Seven jobs, and the weakest hook that does each]{#hook-jobs}
| Job | Weakest hook that works | Why |
| --- | --- | --- |
| Log every tool call | Observer | It needs to see `tool_call_end`{checked=row-36}, not to answer it |
| Draw a progress screen | Observer | The deltas are for display, and nothing flows back |
| Export traces | Observer | A projection of the events, with the tracer isolated from the run |
| Mask old tool output in a long conversation | `transformContext`{checked=row-19} | It changes the view for one request and leaves the transcript alone |
| Refuse a conversation you do not trust | `beforeModelCall`{checked=row-19} with `{ stop }`{checked=row-20} | Only a hook before the call can end the run before anything is sent |
| Block a tool during a change freeze | `beforeToolCall`{checked=row-19} | Only the gate can answer `deny` before the tool runs |
| Redact a secret from a tool result | `afterToolCall`{checked=row-19} | It replaces what the model reads, and a crash withholds the result |
:::

Start each job as an observer, and promote it to an interceptor only when it needs a veto or a replacement. An observer costs the run no decision about order or failure, an interceptor costs both, and the type tells the next reader which of the two you wrote.

## Exercises

1. **Move one hook from an interceptor to an observer, and say what it can no longer do.** In `verify/copilot-sdk/examples/08-hooks.ts`, change `onPostToolUse` so that it only logs the tool's name and returns `null`, as an observer would. Predict which check fails and what the model now reads for `read_ticket`, then run `pnpm test` in `verify/copilot-sdk`. Say what the hook can still do and what it lost. Restore the folder with `git checkout -- examples results` when you are done.
2. **Turn a gate into a logger.** In `verify/langchain/examples/07-middleware.ts`, delete the `if` block in `wrapToolCall` so that it only records the call and returns `handler(request)`. Run `pnpm test` in `verify/langchain` and name the first check that fails. Which sentence of the chapter says what stands between the model and `restart_service` now? Restore the folder with `git checkout -- examples results` when you are done.
3. **Read the last event.** In `verify/pi/examples/01-hello-session.ts`, print `events` after the prompt returns. Which event comes last, and which event closes the model's message? Say which one a log should treat as the end of the run, and why the other is the wrong choice. Restore the folder when you are done.
4. **Sort five jobs.** Count tokens for each run, deny `delete_account`{checked=row-73}, post to a chat channel when a run ends, mask card numbers in tool results, and stop a run after five refunds. For each job, name the weakest hook that does it and the moment it needs. Which of the five could an observer alone do, and what does each of the others need that an observer lacks?
