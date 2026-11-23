---
title: The transcript and the stream
description: A transcript is a list of messages you own, and every model answer arrives as a stream with four rules.
---

A transcript is a list of messages that you own, and every model answer arrives as a stream that follows four rules. You need this to know what your code can rely on when you store a transcript or render a stream.

## A transcript is a list of messages you own

A transcript is the list of messages in a conversation: user messages, assistant messages and tool results. Their content is a short list of blocks: `text`, `reasoning`, `image` and `tool_call`. Your code never handles a provider's wire format.

Every assistant message records its model, why it stopped, any typed error, its usage and its cost. The cost is `null` when the price is unknown, never a guessed zero.

## A transcript replays on another model

You can start a transcript on one model and continue it on another, even from another provider. Before each request, the gateway turns your transcript into one that the target model accepts. It leaves your own transcript as it was, so you keep the full record.

## Every stream follows four rules

A provider adapter streams one model answer as a sequence of events. The sequence follows these rules:

1. A `start` event comes first, once.
2. Each content block runs `*_start`, then any number of `*_delta`, then `*_end`, and keeps one kind.
3. Exactly one terminal event, `done` or `error`, ends the stream.
4. An error terminal has the stop reason `error` or `aborted` and carries the content and usage so far.

An error terminal is how a failed model call ends: as an event with its partial content, never as a thrown exception. A `warning` event can come anywhere between `start` and the terminal, and reports something the call survived.

## A stream ends in the message you keep

The terminal event, `done` or `error`, carries the finished assistant message, with its content, stop reason, usage and cost. A run adds that message to the transcript. It adds each tool result and your own input beside it, so the transcript holds user messages, assistant messages and tool results in the order they happened.

::figure[A model stream becomes one message of the transcript]{id="stream-and-transcript" alt="A stream ends in one terminal event. Its assistant message joins the transcript."}

## A run streams one closed set of events

The SDK's run adds its own events on top, such as `text_delta`, `tool_call_end` and `run_end`. Every event carries the run's `runId`, a `seq` that counts events from 0, a `stepIndex` that counts model calls from 0 and a `timestamp`. The set of event types is closed, so a `switch` over `event.type` can be exhaustive.

Next, see [what the gateway does](/concepts/the-gateway/).
