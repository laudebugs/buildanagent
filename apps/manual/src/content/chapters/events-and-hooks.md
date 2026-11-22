---
title: "Events and hooks: one event union, interceptors and observers"
summary: A run can show what happens inside it and let your code change it, and the two jobs need different surfaces. This chapter shows how an SDK should stream one closed set of events that only describes the run, where it should let code step in, and why observers that only watch belong apart from interceptors that can change a run.
opening: question
sources: [pi-json-events, copilot-streaming-events, buildanagent-sdk-hooks, buildanagent-copilot-sdk-check]
glossary: [delta]
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

## Exercises

1. **Read the stream's last event.** In `verify/pi/examples/01-hello-session.ts`, print `events` after the prompt returns. Which event comes last, and which event closes the model's message? Say which one a log should treat as the end of the run, and why the other would be the wrong choice.
