# What our plans say about voice and realtime (as of November 2026)

Research notes, gathered 2026-11-19 from this branch (`todo/U20-research-voice-and-realtime`, off `main` at `b5fc4f2`). Every claim below was read in the file it cites; nothing outside the repo is quoted here.

**Takeaway.** Our plans say almost nothing about voice. The book plan places it as one section (T38) of Chapter T35, the SDK references put realtime and voice agents out of scope, and the only finding on record is the OpenAI TypeScript SDK's missing voice pipeline. Our gateway's transcript has no audio block and our harness has no audio transport, but the harness protocol already has the two verbs a voice front end needs, `turn/interrupt` and `turn/steer`.

## The book plan and its todos

- **Placement.** The book plan's §4.3 table: "Voice and realtime agents | U20 | T38, a section of T35 | Voice and realtime change how a person interacts with a running agent, which is Chapter T35's subject" ([build-book.md §4.3](../../../plans/build-book.md#43-four-topics-need-research-before-they-are-written)).
- **T38's analogy.** "voice interruption, as a phone call where either side can cut in. Where the analogy breaks: the agent must cancel speech and tool calls already in flight when the person cuts in" ([T38](../../../todos/ready/T38-section-voice-and-realtime.md)).
- **T38's risk.** "The research may show the topic needs a chapter after all; if so, propose it to the owner instead of overfilling the section" ([T38](../../../todos/ready/T38-section-voice-and-realtime.md)).
- **T35's research question.** "How should a person see, steer and take over an agent, in a UI and in a browser, when prompt injection makes the network and the credential the boundary?" Its listings are `verify/vercel-ai-sdk/examples/06-streaming.ts`, `verify/cloudflare-agents/examples/04-chat-agent.ts` and T40's computer-use example ([T35](../../../todos/ready/T35-chapter-agents-people-can-watch.md)). None is a voice example.
- **New examples.** BK20's list of new `verify/` examples (computer use for T35, retrieval for T36 and others) names no voice example ([build-book.md BK20](../../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted)).

## The SDK references and comparison

- **Out of scope.** The SDK references plan, for the OpenAI Agents SDK: "**Out of scope:** the realtime and voice agents, and the Python SDK. Note them in the guide." ([sdk-references.md](../../../plans/sdk-references.md), line 65).
- **The voice-pipeline gap.** "Voice pipeline (speech-to-text, agent, text-to-speech) | `VoicePipeline` (`voice/pipeline.py:24`) with `OpenAISTTModel` and `OpenAITTSModel` ... | No `VoicePipeline`. JavaScript voice agents are realtime agents only (`guides/voice-agents.mdx`)" ([TypeScript gaps](../../../comparison/typescript-gaps.md#openai-agents-sdk-typescript-lacks-storage-backends-the-voice-pipeline-and-developer-utilities)).
- **Where TypeScript leads.** The same section lists "Browser WebRTC: `OpenAIRealtimeWebRTC`", noting the Python docs say Python "provides no browser WebRTC transport", and "Telephony and edge transports: `TwilioRealtimeTransportLayer` and `CloudflareRealtimeTransportLayer` in `@openai/agents-extensions`" ([TypeScript gaps](../../../comparison/typescript-gaps.md)).
- **Footprint.** The feature table lists `agents-realtime` as one of the OpenAI SDK's three packages, and has no voice or realtime row ([feature table](../../../comparison/feature-table.md)).

## The gateway, SDK and harness plans

- **No audio in the transcript.** The gateway's `ContentBlock` union has `text`, `reasoning`, `image` and `tool_call`, and `ModelCaps` has `images: boolean` but no audio flag ([SDK plan §3.2](../../../plans/build-sdk.md#32-gateway-api)). The SDK plan's non-goals do not mention voice ([SDK plan §1](../../../plans/build-sdk.md#1-goal-and-non-goals)).
- **Interrupt and steer exist as protocol verbs.** "Version 1 ships these client methods: `initialize`, `session/create`, `session/open`, `session/list`, `turn/start`, `turn/steer`, `turn/followUp`, `turn/interrupt`, ..." ([harness plan HD6](../../../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods)). `turn/interrupt` takes `{ session, reason? }` (harness plan §3.5, line 561).
- **The log records completed blocks.** HD1: "Deltas (`text_delta` and the rest) reach live clients as protocol events and are never written" ([harness plan HD1](../../../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional)). A voice turn cut off mid-sentence has no such completed block, which is the gap a truncation entry would fill (our inference).
- **WebSocket transport.** "A WebSocket or HTTP-with-SSE transport" left the harness non-goals on 2026-11-18, because "the coding agent's CLI attaches to a Durable Object over WebSocket, so N44 adds the transport" ([harness plan §1](../../../plans/build-harness.md#1-goal-and-non-goals)).
- **Earlier repo finding on WebRTC.** The browser-use report's fact-check row 295 records as an inference that "Neither a Cloudflare sandbox nor a Durable Object offers the UDP path WebRTC wants" ([browser-use fact-check](../../browser-use/fact-check-browser-use.md)).

## What this means for the report (our synthesis)

The report should not propose building voice into our gateway now: no plan needs it, and both SDKs that ship voice already wrap a vendor's realtime API. It can propose recording voice as an explicit non-goal with a reason, and a note that a future voice front end would drive our harness through `turn/interrupt` and `turn/steer` and would need a log entry for a truncated turn. Those are owner decisions.
