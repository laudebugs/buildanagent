# LangChain.js docs: behavior matches 1.6.6, but one block in nine disagrees with its types

A developer who copies an example from the LangChain docs needs it to compile and run against the release npm installed. To test that promise, I checked the JavaScript side of the docs against `langchain@1.6.6`, `@langchain/core@1.4.1` and `@langchain/langgraph@1.7.4`, the newest releases at least a week old as of 2026-11-22. The first round (2026-11-18) pinned 1.6.1, 1.3.4 and 1.6.0; the [update section](#update-to-langchain166-2026-11-22) says what the bump changed. The docs repo, `langchain-ai/docs`, has no tags that match the npm releases, so the mirror pins commit `9d9747d` (2026-11-17): 44 pages covering LangChain agents and the LangGraph pages they rely on, plus the 97 snippet files those pages import. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/langchain/`](../../../verify/langchain/), with raw output in `verify/langchain/results/`. Every behavior we tested worked as documented, and the middleware hooks and recursion limit match the package exactly. The examples fared worst of the five SDKs, though: 78 of 713 blocks fail against the release, in a dozen recurring patterns. Against 1.6.1 five more used names that only newer releases had, but 1.6.6 ships them. The worst pattern makes the overview page's first example throw.

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness
cd verify/langchain
pnpm run fetch-docs       # mirror the pages from langchain-ai/docs@9d9747d (committed; MIT)
pnpm run verify           # extract -> type-check -> triage -> run docs examples -> API diff -> our tests
```

## Tier 1: 224 of 713 blocks compile as written, and 78 disagree with the package

I compiled every TypeScript block against the pinned packages with `tsc` 7 in strict mode (`scripts/typecheck-examples.mjs`). The pages are bilingual, so the extractor first removes every `:::python` block. A second script then checks each API error against the newest releases on the npm registry (`scripts/ahead-of-release.mjs`): a block whose missing names exist only in a newer release counts as *ahead of release*, not wrong. Against 1.6.6 no block does, because the newest release (1.6.7) adds no name that a failing block needs.

| Source | Blocks | pass | fragment | syntax | other | ahead of release | api-mismatch |
|---|---|---|---|---|---|---|---|
| LangChain pages | 294 | 107 | 129 | 34 | 2 | 0 | 22 |
| LangGraph pages | 149 | 23 | 88 | 13 | 1 | 0 | 24 |
| Imported code samples | 270 | 94 | 144 | 0 | 0 | 0 | 32 |
| **Total** | **713** | **224** | **361** | **47** | **3** | **0** | **78** |

The fragments use names defined elsewhere on the page or import packages outside the pinned set, such as `deepagents`, `langsmith` and the Postgres checkpointer. The 47 syntax blocks are deliberate snippets, such as decision objects shown on their own. `scripts/mismatch-causes.mjs` groups the 78 mismatches by cause, and findings F2–F7 cover them. The largest groups are the long-term store (32 errors in 31 blocks), unnarrowed message content (11 in 9), and LangGraph interrupt and state typing (11 in 8).

## Tier 2: 34 of 69 complete examples ran as written, and 12 more ran with a provider prefix

I ran every block that imports LangChain, invokes or streams something, and passed Tier 1: 69 in all (`scripts/run-examples.mjs`). Each ran unmodified under a preload (`scripts/scripted-preload.mjs`). A module hook points `@langchain/anthropic` and `@langchain/openai` at shims whose chat models are scripted, which also covers string model ids, because `initChatModel` imports those packages to resolve them. Each run also got a temp working directory, an allowlisted environment and a network guard:

| Outcome | Count | Notes |
|---|---|---|
| ran, model answered | 21 | Tool loops, structured output (tool and provider strategies), streaming, middleware, `modelRefusalMiddleware` (the scripted model never refuses, so the block shows that it loads and the loop completes) |
| ran, no model call | 13 | Blocks that define graphs, tools or stores without invoking a model |
| ran, threw as documented | 2 | `test/unit-testing.mdx` blocks whose comments say a call throws, and it does |
| skipped | 19 | Providers outside the pinned set (Google, Bedrock, Ollama, OpenRouter, Fireworks, Baseten), external databases and MCP servers, Deep Agents and LangSmith |
| error | 14 | 13 use the bare model id `"gpt-6.1-sol"` (F1); 12 of those ran once prefixed with `openai:`. The 14th also omits a `thread_id` (F2) |

The scripted model calls only tools a block defines, and it refuses tools whose names suggest host access, such as `write_file`. A pass therefore shows that a configuration loads and the loop completes, not that provider-side features behave as described.

## Tier 3: hooks and options match, and the middleware list lags the package

A script compares the docs' API lists with the package's declarations (`scripts/factcheck-api.mjs`):

| Surface | Docs | Package | Differences |
|---|---|---|---|
| Middleware hooks (`middleware/custom.mdx`) | 6 | 6 | None |
| Built-in middleware factories (`middleware/built-in.mdx`) | 14 | 24 | None missing (`modelRefusalMiddleware` arrived in 1.6.4, F3); 10 exported factories, such as `toolErrorMiddleware`, `anthropicPromptCachingMiddleware` and the new `autoModeMiddleware` and `modelRouterMiddleware`, appear on no page in scope. The page's `createFilesystemMiddleware` comes from `deepagents` |
| `createAgent` options used in the JS docs | 10 | 15 | None missing; `description`, `includeAgentName`, `signal`, `streamTransformers` and `version` are used nowhere |
| Recursion-limit default (`langgraph/graph-api.mdx`) | 25 | 25 | None |

## Tier 4: all fourteen documented claims held

Eleven programs in `verify/langchain/examples/` assert documented behavior on LangChain's own `fakeModel()`, and all eleven pass:

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
| A record written on one thread is recalled on another through `runtime.store`, and a recall tool that compares an expiry time with an injected clock deletes the expired record (long-term-memory, runtime) | 11 | ✅ |
| `fakeModel()` scripts responses and records calls (test/unit-testing) | 01–11 | ✅ |

## Nine findings: seven doc errors, one testing gap and one probe

**F1. The docs' default model id can't be resolved, so the first example throws.** Pages use `model: "gpt-6.1-sol"` without a provider prefix, starting at `overview.mdx:31`. `initChatModel` infers a provider only from known name prefixes, and in 1.6.6 the OpenAI ones are `gpt-3`, `gpt-4`, `gpt-5`, `o1`, `o3` and `o4` (`chat_models/universal.js:171`; 1.6.1 had the same list). The call fails with "Unable to infer model provider for { model: gpt-6.1-sol }". This one cause produced 13 of the 14 Tier 2 errors. Write `"openai:gpt-6.1-sol"`.

**F2. A short-term-memory example omits the `thread_id` its checkpointer requires.** `short-term-memory.mdx:75` builds an agent with `MemorySaver` and invokes it without `configurable.thread_id`. LangGraph then throws "missing a required thread_id field", as example 05 shows.

**F3. Pages ran ahead of the 1.6.1 release; 1.6.4 and later ship most of what they documented.** The pages document `modelRefusalMiddleware` and `ModelRefusalError` (`middleware/built-in.mdx:501`, `:530`, `:569`, `models.mdx:1001`, `structured-output.mdx:563`), plus `executionInfo` and `serverInfo` on the tool config. Against 1.6.1, readers who copied them got "no exported member" errors. Release 1.6.4 first shipped `modelRefusalMiddleware` (its tarball holds `dist/agents/middleware/modelRefusal.*`; the 1.6.3 tarball does not), and our pin 1.6.6, published 2026-11-13, exports it from `langchain` (`dist/agents/middleware/modelRefusal.d.ts`, `dist/index.d.ts:50`). `@langchain/core` 1.4.1 exports `ModelRefusalError` from `@langchain/core/errors`. The five refusal blocks now compile apart from names they leave undefined. `executionInfo` and `serverInfo` are in `@langchain/langgraph` 1.7.4's `Runtime` type (`dist/pregel/runnable_types.d.ts:77`, `:79`), but three blocks (`runtime.mdx`, `tools.mdx` twice) still fail, because a tool's second argument is core's `ToolRuntime`, whose 1.4.1 typings have neither field. At run time `runtime.executionInfo` is there (F9). The [update section](#update-to-langchain166-2026-11-22) gives the counts.

**F4. Core's `ToolRuntime` type contradicts the store the docs and the runtime use.** Thirty-one blocks in `runtime.mdx`, `context-engineering.mdx` and the long-term-memory samples call `runtime.store.get(namespace, key)` and `put(...)`. At run time, those calls work, because the store is LangGraph's (example 09). The `ToolRuntime` type in `@langchain/core/tools` declares core's key-value `BaseStore` instead, which has only `mget` and `mset`, so the blocks fail to type-check. Core 1.4.1, the newest release, keeps the same type. Until it changes, cast `runtime.store` to LangGraph's store type.

**F5. Many examples treat message content as a string.** In LangChain 1.x, `message.content` is `string | ContentBlock[]`, but nine blocks assign it to a string field or call string methods on it, mainly in `langgraph/add-memory.mdx`, `streaming.mdx` and `workflows-agents.mdx`. Two more read `tool_calls` from a plain `BaseMessage` without narrowing it to an `AIMessage`.

**F6. The interrupt API is typed loosely, and one page uses old approval flags.** Six blocks in `langgraph/interrupts.mdx` read `result.__interrupt__`, which the typed invoke result lacks, so typed code needs a cast. `guardrails.mdx:131` and `:322` configure approval with `allowAccept`, `allowEdit` and `allowRespond`. Version 1.x takes `allowedDecisions` instead, as the human-in-the-loop page shows.

**F7. Four smaller errors.**
- *Missing await:* three blocks use `initChatModel(...)` without `await`, though it returns a Promise (`context-engineering.mdx:987`, `:1170`, `guardrails.mdx:252`).
- *Wrong trigger shape:* two summarisation examples pass a number as `trigger` where an object such as `{ tokens }` is required (`middleware/built-in.mdx:1500`, `:1571`).
- *Wrong import:* `langgraph/streaming.mdx:748` imports `createAgent` from `@langchain/langgraph`, but it lives in `langchain`.
- *Missing export:* two blocks import an `AgentState` type that `langchain` doesn't export (`middleware/overview.mdx:68`, `multi-agent/subagents.mdx:476`).

**F8. Core's older fake models can't drive an agent; use `fakeModel()`.** `FakeStreamingChatModel` in `@langchain/core/utils/testing` always replays its first response and drops its tool calls, so it can't script a multi-turn tool loop. `fakeModel()`, exported by `langchain`, works and is what the unit-testing page shows. The page is Python-first, though, and its JavaScript `fakeModel` blocks are short; a reader who finds the core fakes first can lose time.

## U18 memory findings: two store traps in the docs, and no expiry in the process (2026-11-19)

The retrieval and memory research (U18) read the store typings of `langchain` 1.6.1 and `@langchain/langgraph-checkpoint` 1.2.3 on 2026-11-19, and the owner approved recording what it found ([U18 report](../../research/memory/retrieval-and-memory.md#all-eight-sdks-retrieve-through-tools-six-ship-long-term-memory-and-none-expires-it-in-the-process); [SDK notes](../../research/memory/notes/sdks-claude-openai-vercel-langchain.md)). The three findings below add to F1–F8 and change none of them.

**M1. The docs' semantic-index form fails to type-check.** The long-term-memory samples build `new InMemoryStore({ index: { embed, dims: 2 } })`, where `embed` is a plain function (`source/src/snippets/code-samples/long-term-memory-storage-inmemory-js.mdx:10`; the Postgres sample at `:12` does the same). The installed `IndexConfig` requires `dims` and `embeddings: Embeddings` and has no `embed` key (`langgraph-checkpoint/dist/store/base.d.ts:237–269`). Pass an `Embeddings` instance, such as `SyntheticEmbeddings` in tests. A second form also disagrees: `put`'s fourth parameter is a positional `index?: false | string[]` (`base.d.ts:359`), not an options object.

**M2. `import { InMemoryStore } from "langchain"` gives the wrong store.** The `langchain` entry point imports `InMemoryStore` from `@langchain/core/stores` and re-exports it (`langchain/dist/index.d.ts:44`, `:47`). That class is core's key-value store, which `createAgent({ store })` does not accept. Import the store from `@langchain/langgraph`, as every mirrored snippet does.

**M3. Nothing expires a store item inside the process.** The checkpoint package's store typings have no TTL argument or field. A TTL exists only on the Agent Server client, `@langchain/langgraph-sdk`'s `StoreClient.putItem(..., { ttl })`, which talks to a remote server ([SDK notes](../../research/memory/notes/sdks-claude-openai-vercel-langchain.md)). An agent that needs expiry must store an expiry time in the item and filter on it, which todo T43 shows.

## Update to langchain@1.6.6 (2026-11-22)

The weekly update job moved the harness from `langchain@1.6.1`, `@langchain/core@1.3.4`, `@langchain/langgraph@1.6.0`, `@langchain/anthropic@1.6.0` and `@langchain/openai@1.8.0` to `1.6.6`, `1.4.1`, `1.7.4`, `1.6.5` and `1.8.4`, all published at least nine days earlier (npm registry times). The docs mirror stays at commit `9d9747d`, because the docs repo has no tags to follow. I reran `pnpm run verify` and compared each result file with the previous run by block id.

| Measure | 1.6.1 run | 1.6.6 run |
|---|---|---|
| Blocks that pass | 219 | 224 |
| Fragments / syntax / other | 361 / 47 / 3 | 361 / 47 / 3 |
| Ahead of the release | 5 | 0 |
| API mismatches | 78 | 78 |
| Complete examples that ran with a model answer | 20 of 68 | 21 of 69 |
| Built-in middleware factories in the package | 21 | 24 |

- **Five blocks left "ahead of release".** Three refusal blocks in `middleware/built-in.mdx` (the ones that import `modelRefusalMiddleware` and `ModelRefusalError`) now pass, and `middleware/built-in.mdx:530` now runs. The `models.mdx` and `structured-output.mdx` blocks became fragments, because they use `model`, `Movie` and `ProductRating`, which the page defines elsewhere.
- **Two more blocks pass for an unrelated reason.** The two `test/integration-testing.mdx` blocks import `vitest`, which the workspace now installs for every package; this is not a LangChain change.
- **No regression.** The 78 mismatches are the same blocks in the same twelve cause groups. One block's error list lost its `vitest` import error, and the three blocks that use `executionInfo` or `serverInfo` stay mismatches (F3). Every other doc run, example and behavioral test gave the same outcome as before, and the transcripts differ only in their version fields.

- **Correction (2026-11-22): `modelRefusalMiddleware` first shipped in 1.6.4, not 1.6.6.** An earlier draft of this section and of the guide said it arrived in 1.6.6. Unpacking the npm tarballs (`npm pack langchain@1.6.3`, `@1.6.4`, `@1.6.5`) shows `dist/agents/middleware/modelRefusal.*` in 1.6.4 and 1.6.5 and not in 1.6.3 (1.6.2 also lacks it). The 1.6.1 pin lacked it, so F3 stands; only the release that first ships it changes.

**F9. `modelRefusalMiddleware` works, and `executionInfo` exists at run time although its type does not.** A one-off probe on 1.6.6 (not committed) ran a `fakeModel()` that answers with a `refusal` content block under `createAgent({ middleware: [modelRefusalMiddleware()] })`. The run threw a `ModelRefusalError` ("Model refused to produce the requested output: no"), and `ModelRefusalError.isInstance` returned true. The `.d.ts` says the middleware does not detect a refusal the model writes as plain text, and that a retry middleware does not retry a refusal, so list it after `modelFallbackMiddleware` (`dist/agents/middleware/modelRefusal.d.ts`, doc comment). A second probe ran a tool through `createAgent` and read its second argument: `runtime.executionInfo` held `checkpointId`, `checkpointNs`, `taskId`, `threadId`, `nodeAttempt` and `nodeFirstAttemptTime`, and `runtime.serverInfo` was `undefined` off the Agent Server (the page says `null`). These probes are all that tests the factory and the error class: no example in `verify/langchain/examples/` covers them, and no real provider refused anything.

## TypeScript parity

LangChain is Python first, so the [TypeScript gap report](../../comparison/typescript-gaps.md#langchain-typescript-lacks-the-shell-and-file-search-middleware-checkpoint-encryption-and-test-suites) compares `langchain` 1.6.1 and `@langchain/langgraph` 1.6.0, the first-round pins, with Python `langchain` 1.4.8 and `langgraph` 1.2.19 at their release tags. The middleware hooks, most built-in middleware and the graph and functional APIs match. JavaScript lacks eight Python features, among them `ShellToolMiddleware`, `FilesystemFileSearchMiddleware`, the encrypted checkpoint serializer, the checkpointer conformance suite and `RemainingSteps`. Rate limiting and typed model errors are weaker. Four JavaScript exports, such as `toolErrorMiddleware` and `configurableFields`, appear only in `:::python` sections, so a Python-only heading on these bilingual pages is no proof of absence; check the `.d.ts` of your release first.

## Verdict: trust the behavior, and compile examples against your release before copying them

Every LangChain.js behavior we tested matched its docs, from interrupts and resume to thread memory, middleware order, the recursion limit and streaming modes. The API lists are also sound: the six middleware hooks and the recursion default match exactly, and every `createAgent` option the docs use exists. The JavaScript examples are where the docs fall short. They share pages with Python, they ran ahead of the release until 1.6.4 and later releases caught up, and they repeat a few typing slips. Before you copy one, prefix model ids with their provider (F1), pass a `thread_id` whenever a checkpointer is set (F2), and compile the example against your pinned version. Then rerun `pnpm run verify` at each upgrade to catch the next page that runs ahead.
