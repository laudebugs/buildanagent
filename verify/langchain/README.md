# verify/langchain

Offline verification harness for the LangChain.js v1 agent docs and our examples, pinned to `langchain@1.6.6` with `@langchain/core@1.4.1`, `@langchain/langgraph@1.7.4`, `@langchain/anthropic@1.6.5` and `@langchain/openai@1.8.4`. No API key is needed.

## How it works

- **Doc examples** run unmodified under `scripts/scripted-preload.mjs`. A module hook (`scripts/hooks.mjs`) points `@langchain/anthropic` and `@langchain/openai` at the shims in `shims/`, whose `ChatAnthropic` and `ChatOpenAI` are scripted chat models. The hook also covers string model ids such as `"anthropic:claude-…"`, because `initChatModel` resolves them by importing those packages. The preload rejects any non-local `fetch`.
- **The scripted model** (`scripts/scripted-model.mjs`) is a `BaseChatModel`. It calls one bound tool (preferring one the prompt names) with arguments built from its JSON Schema, calls createAgent's structured-output tool after a tool result, answers with schema-shaped JSON when `providerStrategy` binds a `response_format`, and denies tools whose names suggest host access.
- **Each run** gets a temp working directory with `fixtures/`, an allowlisted environment and a timeout. A block that fails only because its bare model id (such as `"gpt-6.1-sol"`) can't be mapped to a provider is recorded as an error and rerun with an `openai:` prefix, so the rest of it is still exercised.
- **Extraction** drops `:::python` blocks from the mixed-language pages and keeps every TypeScript block, including the code-sample snippets the pages import.
- **Our examples** (`examples/`) use LangChain's own `fakeModel()` from `langchain`.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result, and, when the call stack shows it, the example line that led to each event.

`scripts/run-examples.mjs` preloads the recorder from [`scripts/transcripts/`](../../scripts/transcripts/), which records each `check()` from the `ok - ` line it prints, and only when the call stack shows `check()` printed it. `examples/lib/transcript.ts`, which `lib/check.ts` imports, wraps the model that `fakeModel()` builds and an agent's `invoke`, `stream` and `streamEvents`, so a request carries the line of the call that started the run. For a queued tool call the fake model makes up text from the whole conversation, so the transcript keeps only that text's length, as a `derived-text` part.

Recording only reads what the mock already holds, so it changes no verdict. The writer replaces the run's own directories, and the ids, timestamps and durations the SDK generated, with placeholders. An id the mock's script chose stays as written, and so does everything else an example scripts, such as a tool's input. Two runs on any machine therefore write the same bytes.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## The store example builds the expiry that no store provides

`examples/11-store-recall-expire.ts` runs the long-term-memory exercise on LangGraph's `InMemoryStore`. One `createAgent` run writes a record with a subject, the fact, its source, a created time and an expiry time. A run on another `thread_id` recalls it through a tool that calls `runtime.store.search`. The installed store has no expiry setting (the [reference's M3](../../docs/reference/langchain/fact-check.md)), so the recall tool compares each record's expiry with an injected clock, drops an expired record and deletes it. Its checks show that the second thread recalls the fact and its source, that after the clock passes the expiry the tool returns nothing and `store.get` returns null, and that the first thread's `MemorySaver` checkpoint still holds the fact in the write's tool call, so deleting a memory does not delete it from the session log. They also show that the store comes from `@langchain/langgraph`, because the `InMemoryStore` that `langchain` exports is core's key-value store and has no `search()`. The example builds no `index`, so the docs' `index: { embed, dims }` form, which the installed `IndexConfig` does not accept, is not exercised ([fact-check log](../../docs/plans/reviews/fact-check-langchain-store-example.md)).

## The thread-owner example refuses another user's thread

`examples/12-thread-owner.ts` shows two of Chapter 5's ownership rules on LangChain. `MemorySaver` files a thread by `thread_id` alone, so the example's `chat()` function keeps a map from thread id to owner. It records the owner when a call without a thread id starts a thread, and it checks the owner on every later call before `agent.invoke` runs. Its checks show three things. Bob's call with Ada's thread id and his call with an id nobody created return the same `NOT_FOUND`, word for word. Neither call reaches the model. Ada's next call still sees her earlier messages. The map lives in process memory, as `MemorySaver` does; a real server keeps the owner in its database. The chapter lists the `server` region with notes and a replay.

## A live run sends one example to a real provider

The book's occasional live run ([`scripts/live/`](../../scripts/live/), started only by `.github/workflows/live-run.yml`) calls `scripts/run-examples.mjs examples --only <example> --live`. In that mode `examples/lib/live.ts`, which `lib/check.ts` imports before the recorder, replaces the `_generate` of `fakeModel()`'s class. Every fake model then sends its calls, with the tools bound to it, to the pinned `@langchain/anthropic` or `@langchain/openai`, and still counts them in `callCount` and `calls`. The key is passed explicitly, the output is capped at the run's `maxTokens`, a provider tool is refused, and the cost guard checks each call before it is sent. The answer keeps only the provider's content, tool calls and usage, and the transcript goes to `results/live/<provider>/<example>.json`. Without `--live`, nothing in the live mode runs, so `pnpm test` and the committed transcripts are unchanged.

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirror the in-scope pages, their snippets and the license from `langchain-ai/docs` at the commit pinned in `scripts/fetch-docs.mjs` (committed) |
| `pnpm run extract` | Pull every JS/TS block into `extracted/` (gitignored) |
| `pnpm run typecheck:docs` | Compile every block against the pinned packages and classify errors → `results/typecheck-docs.json` |
| `pnpm run triage:docs` | Mark mismatches that only use names from newer releases (`ahead-of-release`, needs the npm registry) and group the rest by cause → `results/mismatch-causes.json` |
| `pnpm run run:docs` | Run complete, type-clean blocks on the scripted model → `results/run-docs.json` |
| `pnpm run factcheck` | Diff middleware hooks, built-in middleware, `createAgent` options and the recursion default against the package → `results/factcheck-api.json` |
| `pnpm test` | Type-check and run our examples → `results/run-examples.json` |
| `pnpm run verify` | All of the above except `fetch-docs` |
