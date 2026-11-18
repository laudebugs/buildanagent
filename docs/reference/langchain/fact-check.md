# LangChain.js docs: behavior matches 1.6.1, but one block in nine disagrees with its types

A developer who copies an example from the LangChain docs needs it to compile and run against the release npm installed. To test that promise, I checked the JavaScript side of the docs against `langchain@1.6.1`, `@langchain/core@1.3.4` and `@langchain/langgraph@1.6.0`, the newest releases at least two weeks old. The docs repo, `langchain-ai/docs`, has no tags that match the npm releases, so the mirror pins commit `9d9747d` (2026-11-17): 44 pages covering LangChain agents and the LangGraph pages they rely on, plus the 97 snippet files those pages import. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/langchain/`](../../../verify/langchain/), with raw output in `verify/langchain/results/`. Every behavior we tested worked as documented, and the middleware hooks and recursion limit match the package exactly. The examples fared worst of the five SDKs, though: 83 of 713 blocks fail against the release. Five use names from newer releases, and the other 78 fall into a dozen recurring patterns. The worst pattern makes the overview page's first example throw.

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness
cd verify/langchain
pnpm run fetch-docs       # mirror the pages from langchain-ai/docs@9d9747d (committed; MIT)
pnpm run verify           # extract -> type-check -> triage -> run docs examples -> API diff -> our tests
```

## Tier 1: 219 of 713 blocks compile as written, and 83 disagree with the package

I compiled every TypeScript block against the pinned packages with `tsc` 7 in strict mode (`scripts/typecheck-examples.mjs`). The pages are bilingual, so the extractor first removes every `:::python` block. A second script then checks each API error against the newest releases on the npm registry (`scripts/ahead-of-release.mjs`): a block whose missing names exist only in a newer release counts as *ahead of release*, not wrong.

| Source | Blocks | pass | fragment | syntax | other | ahead of release | api-mismatch |
|---|---|---|---|---|---|---|---|
| LangChain pages | 294 | 102 | 129 | 34 | 2 | 5 | 22 |
| LangGraph pages | 149 | 23 | 88 | 13 | 1 | 0 | 24 |
| Imported code samples | 270 | 94 | 144 | 0 | 0 | 0 | 32 |
| **Total** | **713** | **219** | **361** | **47** | **3** | **5** | **78** |

The fragments use names defined elsewhere on the page or import packages outside the pinned set, such as `deepagents`, `langsmith` and the Postgres checkpointer. The 47 syntax blocks are deliberate snippets, such as decision objects shown on their own. `scripts/mismatch-causes.mjs` groups the 78 mismatches by cause, and findings F2–F7 cover them. The largest groups are the long-term store (32 errors in 31 blocks), unnarrowed message content (11 in 9), and LangGraph interrupt and state typing (11 in 8).

## Tier 2: 33 of 68 complete examples ran as written, and 12 more ran with a provider prefix

I ran every block that imports LangChain, invokes or streams something, and passed Tier 1: 68 in all (`scripts/run-examples.mjs`). Each ran unmodified under a preload (`scripts/scripted-preload.mjs`). A module hook points `@langchain/anthropic` and `@langchain/openai` at shims whose chat models are scripted, which also covers string model ids, because `initChatModel` imports those packages to resolve them. Each run also got a temp working directory, an allowlisted environment and a network guard:

| Outcome | Count | Notes |
|---|---|---|
| ran, model answered | 20 | Tool loops, structured output (tool and provider strategies), streaming, middleware |
| ran, no model call | 13 | Blocks that define graphs, tools or stores without invoking a model |
| ran, threw as documented | 2 | `test/unit-testing.mdx` blocks whose comments say a call throws, and it does |
| skipped | 19 | Providers outside the pinned set (Google, Bedrock, Ollama, OpenRouter, Fireworks, Baseten), external databases and MCP servers, Deep Agents and LangSmith |
| error | 14 | 13 use the bare model id `"gpt-6.1-sol"` (F1); 12 of those ran once prefixed with `openai:`. The 14th also omits a `thread_id` (F2) |

The scripted model calls only tools a block defines, and it refuses tools whose names suggest host access, such as `write_file`. A pass therefore shows that a configuration loads and the loop completes, not that provider-side features behave as described.

## Tier 3: hooks and options match, and the middleware list lags in both directions

A script compares the docs' API lists with the package's declarations (`scripts/factcheck-api.mjs`):

| Surface | Docs | Package | Differences |
|---|---|---|---|
| Middleware hooks (`middleware/custom.mdx`) | 6 | 6 | None |
| Built-in middleware factories (`middleware/built-in.mdx`) | 14 | 21 | `modelRefusalMiddleware` is not in 1.6.1 (F3); 8 exported factories, such as `toolErrorMiddleware` and `anthropicPromptCachingMiddleware`, appear on no page in scope. The page's `createFilesystemMiddleware` comes from `deepagents` |
| `createAgent` options used in the JS docs | 10 | 15 | None missing; `description`, `includeAgentName`, `signal`, `streamTransformers` and `version` are used nowhere |
| Recursion-limit default (`langgraph/graph-api.mdx`) | 25 | 25 | None |

## Tier 4: all thirteen documented claims held

Ten programs in `verify/langchain/examples/` assert documented behavior on LangChain's own `fakeModel()`, and all ten pass:

| Claim (doc page) | Test | Result |
|---|---|---|
| `createAgent` returns the thread's messages; `systemPrompt` becomes the system message (agents) | 01 | ✅ |
| A Zod tool gets parsed input, and its `ToolMessage` reaches the next model call (tools) | 02 | ✅ |
| `humanInTheLoopMiddleware` interrupts before the tool and returns `__interrupt__` with the action request (human-in-the-loop) | 03 | ✅ |
| Resuming with `Command({ resume: { decisions } })` runs an approved tool once and never a rejected one (human-in-the-loop) | 03 | ✅ |
| `responseFormat` yields a typed `structuredResponse` (structured-output) | 04 | ✅ |
| A checkpointer keeps a thread's history per `thread_id`; a new id starts empty (short-term-memory) | 05 | ✅ |
| A checkpointed agent without a `thread_id` throws (persistence) | 05 | ✅ |
| The recursion limit defaults to 25 super-steps and throws `GraphRecursionError` (graph-api) | 06 | ✅ |
| `recursionLimit` in the config lowers it (graph-api) | 06 | ✅ |
| Middleware hooks run in loop order, and `wrapToolCall` can answer for a tool (middleware/custom) | 07 | ✅ |
| `streamMode` `"updates"` and `"values"` yield per-step and full-state chunks (streaming) | 08 | ✅ |
| Tools reach the agent's store as `runtime.store`, with `get()` and `put()` (long-term-memory, runtime) | 09 | ✅ |
| `fakeModel()` scripts responses and records calls (test/unit-testing) | 01–10 | ✅ |

## Eight findings: seven doc errors and one testing gap

**F1. The docs' default model id can't be resolved, so the first example throws.** Pages use `model: "gpt-6.1-sol"` without a provider prefix, starting at `overview.mdx:31`. `initChatModel` infers a provider only from known name prefixes, and in 1.6.1 the OpenAI ones are `gpt-3`, `gpt-4`, `gpt-5`, `o1`, `o3` and `o4` (`chat_models/universal.js`). The call fails with "Unable to infer model provider for { model: gpt-6.1-sol }", and the newest release, 1.6.6, has the same rule. This one cause produced 13 of the 14 Tier 2 errors. Write `"openai:gpt-6.1-sol"`.

**F2. A short-term-memory example omits the `thread_id` its checkpointer requires.** `short-term-memory.mdx:75` builds an agent with `MemorySaver` and invokes it without `configurable.thread_id`. LangGraph then throws "missing a required thread_id field", as example 05 shows.

**F3. Several pages run ahead of the 1.6.1 release.** The pages document `modelRefusalMiddleware` and `ModelRefusalError` (`middleware/built-in.mdx:501`, `:530`, `:569`, `models.mdx:1001`, `structured-output.mdx:563`), plus `executionInfo` and `serverInfo` on the tool config. These names exist only in langchain 1.6.6 and langgraph 1.7.5, which postdate the pin. Readers on the release they installed get "no exported member" errors.

**F4. Core's `ToolRuntime` type contradicts the store the docs and the runtime use.** Thirty-one blocks in `runtime.mdx`, `context-engineering.mdx` and the long-term-memory samples call `runtime.store.get(namespace, key)` and `put(...)`. At run time, those calls work, because the store is LangGraph's (example 09). The `ToolRuntime` type in `@langchain/core/tools` declares core's key-value `BaseStore` instead, which has only `mget` and `mset`, so the blocks fail to type-check. Core 1.4.1, the newest release, keeps the same type. Until it changes, cast `runtime.store` to LangGraph's store type.

**F5. Many examples treat message content as a string.** In LangChain 1.x, `message.content` is `string | ContentBlock[]`, but nine blocks assign it to a string field or call string methods on it, mainly in `langgraph/add-memory.mdx`, `streaming.mdx` and `workflows-agents.mdx`. Two more read `tool_calls` from a plain `BaseMessage` without narrowing it to an `AIMessage`.

**F6. The interrupt API is typed loosely, and one page uses old approval flags.** Six blocks in `langgraph/interrupts.mdx` read `result.__interrupt__`, which the typed invoke result lacks, so typed code needs a cast. `guardrails.mdx:131` and `:322` configure approval with `allowAccept`, `allowEdit` and `allowRespond`. Version 1.x takes `allowedDecisions` instead, as the human-in-the-loop page shows.

**F7. Four smaller errors.**
- *Missing await:* three blocks use `initChatModel(...)` without `await`, though it returns a Promise (`context-engineering.mdx:987`, `:1170`, `guardrails.mdx:252`).
- *Wrong trigger shape:* two summarisation examples pass a number as `trigger` where an object such as `{ tokens }` is required (`middleware/built-in.mdx:1500`, `:1571`).
- *Wrong import:* `langgraph/streaming.mdx:748` imports `createAgent` from `@langchain/langgraph`, but it lives in `langchain`.
- *Missing export:* two blocks import an `AgentState` type that `langchain` doesn't export (`middleware/overview.mdx:68`, `multi-agent/subagents.mdx:476`).

**F8. Core's older fake models can't drive an agent; use `fakeModel()`.** `FakeStreamingChatModel` in `@langchain/core/utils/testing` always replays its first response and drops its tool calls, so it can't script a multi-turn tool loop. `fakeModel()`, exported by `langchain`, works and is what the unit-testing page shows. The page is Python-first, though, and its JavaScript `fakeModel` blocks are short; a reader who finds the core fakes first can lose time.

## Verdict: trust the behavior, and compile examples against your release before copying them

Every LangChain.js behavior we tested matched its docs, from interrupts and resume to thread memory, middleware order, the recursion limit and streaming modes. The API lists are also sound: the six middleware hooks and the recursion default match exactly, and every `createAgent` option the docs use exists. The JavaScript examples are where the docs fall short. They share pages with Python, they run ahead of the release, and they repeat a few typing slips. Before you copy one, prefix model ids with their provider (F1), pass a `thread_id` whenever a checkpointer is set (F2), and compile the example against your pinned version. Then rerun `pnpm run verify` at each upgrade to catch the next page that runs ahead.
