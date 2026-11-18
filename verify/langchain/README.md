# verify/langchain

Offline verification harness for the LangChain.js v1 agent docs and our examples, pinned to `langchain@1.6.1` with `@langchain/core@1.3.4`, `@langchain/langgraph@1.6.0`, `@langchain/anthropic@1.6.0` and `@langchain/openai@1.8.0`. No API key is needed.

## How it works

- **Doc examples** run unmodified under `scripts/scripted-preload.mjs`. A module hook (`scripts/hooks.mjs`) points `@langchain/anthropic` and `@langchain/openai` at the shims in `shims/`, whose `ChatAnthropic` and `ChatOpenAI` are scripted chat models. The hook also covers string model ids such as `"anthropic:claude-…"`, because `initChatModel` resolves them by importing those packages. The preload rejects any non-local `fetch`.
- **The scripted model** (`scripts/scripted-model.mjs`) is a `BaseChatModel`. It calls one bound tool (preferring one the prompt names) with arguments built from its JSON Schema, calls createAgent's structured-output tool after a tool result, answers with schema-shaped JSON when `providerStrategy` binds a `response_format`, and denies tools whose names suggest host access.
- **Each run** gets a temp working directory with `fixtures/`, an allowlisted environment and a timeout. A block that fails only because its bare model id (such as `"gpt-6.1-sol"`) can't be mapped to a provider is recorded as an error and rerun with an `openai:` prefix, so the rest of it is still exercised.
- **Extraction** drops `:::python` blocks from the mixed-language pages and keeps every TypeScript block, including the code-sample snippets the pages import.
- **Our examples** (`examples/`) use LangChain's own `fakeModel()` from `langchain`.

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
