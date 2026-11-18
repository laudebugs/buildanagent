# 0002. Build Anthropic Messages and OpenAI-compatible Chat Completions adapters first, on plain `fetch`

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D2](../plans/build-sdk.md#d2-anthropic-messages-and-openai-compatible-chat-completions-first-accepted)

## Context

Guide decision 2 asks which wire protocols get adapters in v1. The G3 agent needs a judge model that differs from the agent's, so its eval suite needs two providers. Our harnesses already mock the Anthropic Messages API, and one Chat Completions adapter serves many OpenAI-compatible vendors. OpenAI Responses rests on SDK types only, because its docs were unreachable during the research.

## Decision

v1 ships `anthropic()` and `openaiChat()`. Both call `fetch` through an injectable `Transport`, with no vendor SDK, so the gateway owns retries and the base-URL override. OpenAI Responses is deferred.

## Consequences

- The owner may swap the second provider (for example to Gemini); the adapter interface does not change.
- The gateway has no runtime dependencies.
- Each adapter needs its own SSE parser and wire fixtures (todos B8, B9).
