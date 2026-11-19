---
"@buildanagent/gateway": minor
---

First public release. The gateway calls a model through one transcript and one stream format, whichever provider serves it.

- **Transcript types.** `Message`, its content blocks and `AssistantMessage`, which records the model, the stop reason, a typed error, the token `Usage` and the `Cost` of every reply.
- **`createModel()`.** Binds an adapter to a model id, retries a failed call only before the model streams output, runs `ModelMiddleware` around every call, and hands `onRequest` a copy of each request it sends.
- **The price catalog.** `defaultCatalog` prices every message's usage, `projectCallCost()` estimates a call before you send it, and an unknown price is `null`, never zero.
- **`transformMessages()`.** Prepares a transcript recorded on one model for another: it drops failed turns and reasoning the target can't read, and pairs every tool call with its result.
- **The tool-name rule.** `createToolNameMap()` and `TOOL_NAME_RULES` keep one tool name valid for every provider.
- **Two adapters.** `anthropic()` from `@buildanagent/gateway/anthropic` speaks the Anthropic Messages API, and `openaiChat()` from `@buildanagent/gateway/openai-chat` speaks Chat Completions to OpenAI and to servers that copy it.
- **Offline testing.** `@buildanagent/gateway/testing` holds `mockTransport()`, the stream-contract check and seeded randomness, and importing `@buildanagent/gateway/testing/setup` keeps a test file offline: it blocks requests to any host but the local machine and stops a run that finds a provider API key.
