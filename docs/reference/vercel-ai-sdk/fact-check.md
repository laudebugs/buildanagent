# The Vercel AI SDK docs match `ai@7.0.162` in their API tables, but a dozen examples lag the release

A developer who copies an example from the AI SDK docs needs it to compile and run against the release npm installed. To test that promise, I checked the agent-relevant pages at git tag `ai@7.0.162` against `ai@7.0.162`, the newest release at least two weeks old. The pages are 74 MDX files, the scope the owner chose: AI SDK Core, agents, harnesses, the core reference, the OpenAI and Anthropic provider pages and the Node cookbook. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/vercel-ai-sdk/`](../../../verify/vercel-ai-sdk/), with raw output in `verify/vercel-ai-sdk/results/`. The reference tables passed cleanly: every documented option of `generateText`, `streamText`, `ToolLoopAgent` and `tool()` exists, and the 20-step default matches. The examples fared worse. Twelve of the 741 blocks fail to compile against the release, because they use names from older majors, omit required arguments or misuse types, and one more compiles but throws at runtime.

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness
cd verify/vercel-ai-sdk
pnpm run fetch-docs       # mirror the pages from tag ai@7.0.162 (committed; Apache-2.0)
pnpm run verify           # extract -> type-check -> run docs examples -> API diff -> our tests
```

## Tier 1: 190 of 741 blocks compile as written, and 12 disagree with the package

I compiled every TypeScript block against the pinned packages with `tsc` 7 in strict mode (`scripts/typecheck-examples.mjs`). The extractor first fills the docs' `__MODEL__` and `__PROVIDER_IMPORT__` placeholders the way ai-sdk.dev renders them by default: the gateway string `"anthropic/claude-sonnet-5.5"` and no provider import. To make more blocks checkable, the harness also installs the companions released with `ai@7.0.162`: `@ai-sdk/mcp`, `@ai-sdk/harness`, `@ai-sdk/otel`, `@ai-sdk/provider` and `@ai-sdk/provider-utils`.

| Source | Blocks | pass | fragment | syntax | other | api-mismatch |
|---|---|---|---|---|---|---|
| Docs (core, agents, harnesses) | 437 | 89 | 325 | 20 | 0 | 3 |
| Core reference | 91 | 22 | 62 | 4 | 1 | 2 |
| Provider pages (OpenAI, Anthropic) | 169 | 70 | 80 | 13 | 1 | 5 |
| Node cookbook | 44 | 9 | 32 | 1 | 0 | 2 |
| **Total** | **741** | **190** | **499** | **38** | **2** | **12** |

Most blocks are fragments by design. They use a `model`, `tools` or `messages` defined elsewhere on the page, elide arguments with `// ...`, or import packages outside the pinned set, such as `@ai-sdk/workflow` and `@vercel/sandbox`. The 38 syntax blocks are deliberate snippets: object literals, option excerpts and bare `return` statements. The classifier makes three judgment calls, each recorded in the script. A block that elides arguments counts as a fragment when its only error is the call's shape. An undeclared `prompt` or `event` that resolves to a DOM global counts as context. And one block whose agent comes from an unresolvable `@/` import is a fragment. I reviewed every remaining API-coded error by hand, and findings F1 and F3–F7 cover all of them.

## Tier 2: 116 of 131 complete examples ran offline on a mock model

I ran every block that imports the SDK, calls a generation or agent API, and passed Tier 1, 131 in all (`scripts/run-examples.mjs`). Each ran unmodified under a preload (`scripts/mock-preload.mjs`). A module hook points `@ai-sdk/openai` and `@ai-sdk/anthropic` at shims that return `MockLanguageModelV4` instances, and `globalThis.AI_SDK_DEFAULT_PROVIDER` sends model strings to the same mock instead of the AI Gateway. Each run also got a temp working directory, an allowlisted environment and a network guard that rejects any non-local `fetch`:

| Outcome | Count | Notes |
|---|---|---|
| ran, model answered | 116 | Includes tool loops, structured output, streaming, `ToolLoopAgent` and provider-tool configurations |
| ran, no model call | 10 | Five workflow-pattern blocks and one typed-tool block define functions they never call; four `testing` blocks drive their own mock |
| skipped | 4 | External MCP servers (2), the Anthropic Files API (1), an embedding model (1) |
| error | 1 | `openai.mdx:2547` passes a system message in `messages` and throws `InvalidPromptError` (F2) |

The mock model calls only function tools you define, never provider-defined tools, and it refuses function tools whose names suggest host access, such as `writeFile`. A pass therefore shows that a configuration loads and the loop completes. It doesn't show that provider tools, such as Anthropic's bash tool or OpenAI's web search, behave as described.

## Tier 3: every documented option exists, and a few package options go unlisted

A script compares the reference pages' parameter tables with the options the package accepts (`scripts/factcheck-api.mjs`). For `generateText` and `streamText`, it reads the keys the implementation destructures; for `ToolLoopAgent` and `tool()`, it reads the type declarations. It treats `experimental_X` as a deprecated alias when `X` also exists:

| Surface | Docs | Package | Differences |
|---|---|---|---|
| `generateText` parameters | 51 | 60 | `experimental_toolApprovalSecret` unlisted (the tool-approvals page covers it); 8 deprecated aliases unlisted |
| `streamText` parameters | 57 | 66 | The same |
| `ToolLoopAgent` settings | 45 | 54 | `onLanguageModelCallStart`, `onLanguageModelCallEnd`, `reasoning`, `timeout` and `experimental_toolApprovalSecret` unlisted; 4 aliases unlisted |
| `tool()` options | 21 | 21 | None |
| Stop helpers `isStepCount`, `hasToolCall`, `isLoopFinished` | 3 | 3 | None; the older alias `stepCountIs` is also exported |
| `ToolLoopAgent` default step cap | 20 | 20 | None |

No documented option is missing from the package. The tables lag only in the other direction, by a few options per function.

## Tier 4: all fourteen documented claims held

Nine programs in `verify/vercel-ai-sdk/examples/` assert documented behavior on `MockLanguageModelV4`, and all nine pass:

| Claim (doc page) | Test | Result |
|---|---|---|
| `generateText` returns text, steps, usage and `finishReason`; `instructions` become the system message (generating-text) | 01 | ✅ |
| A system message in `messages` throws unless `allowSystemInMessages` is set (model-message reference) | 01 | ✅ |
| `execute()` gets schema-parsed input, and its result reaches the next request (tools-and-tool-calling) | 02 | ✅ |
| Invalid tool input becomes a `tool-error`, and the loop continues (tools-and-tool-calling) | 02 | ✅ |
| `toolApproval: 'user-approval'` returns a `tool-approval-request`; the tool runs once after approval and never after denial (tool-approvals) | 03 | ✅ |
| A `'denied'` policy skips the tool without stopping the loop (tool-approvals) | 03 | ✅ |
| `prepareStep` runs before each step, and its `activeTools` and `toolChoice` shape the request (loop-control) | 04 | ✅ |
| `Output.object` asks for JSON and types `result.output` (generating-structured-data) | 05 | ✅ |
| A schema failure rejects with `NoObjectGeneratedError`; reading output after a tool-call finish throws `NoOutputGeneratedError` (generating-structured-data) | 05 | ✅ |
| `textStream`, typed stream parts and `onEnd` behave as described (generating-text) | 06 | ✅ |
| `ToolLoopAgent` stops after 20 steps by default and logs a warning; an explicit `stopWhen` logs none (loop-control) | 07 | ✅ |
| `hasToolCall` stops after that tool's step; condition arrays stop when any holds (loop-control, has-tool-call) | 07 | ✅ |
| MCP tools become AI SDK tools, and a custom transport works (mcp-tools) | 08 | ✅ |
| `MockLanguageModelV4` keeps tests offline (testing) | 01–09 | ✅ |

One test of my own was wrong at first. Example 05 expected `NoOutputGeneratedError` for a schema failure, but the docs say `NoObjectGeneratedError`, and the package agrees. I fixed the test and added the case the docs assign to `NoOutputGeneratedError`.

## Eight findings: seven doc errors, one gap in the tables

**F1. Three examples read `textDelta` from stream parts.** In 7.0, a `text-delta` part carries its text in `text`, and reasoning arrives as `reasoning-delta` parts. Yet `foundations/06-provider-options.mdx:95`, `ai-sdk-core/26-reasoning.mdx:39` and `openai.mdx:498` still read `part.textDelta`, and the reasoning page tests `part.type === 'reasoning'`, a type that no longer exists. Neither condition can match, so these examples print nothing. Example 06 shows the current shape.

**F2. The OpenAI provider page passes a system message in `messages` without the opt-in.** The `systemMessageMode` example at `openai.mdx:2547` sends `{ role: 'system', … }` inside `messages`. In 7.0, that call throws `InvalidPromptError`: "System messages are not allowed in the prompt or messages fields." The same page says at line 397 that you "must set `allowSystemInMessages: true`", but this example omits it. It is the only Tier 2 error.

**F3. `Output.object` takes `name` and `description`, not `schemaName`.** The OpenAI page's `strictJsonSchema` example at `openai.mdx:2581` passes `schemaName` and `schemaDescription` to `Output.object`. Those are options of the deprecated `generateObject`, and with them the example fails to compile.

**F4. The middleware metadata example reads the wrong field and breaks with the default model.** `ai-sdk-core/40-middleware.mdx:577` logs `params.providerMetadata`, but language-model call options carry `providerOptions`, which is the field the page's own text names. The example also wraps `__MODEL__` in `wrapLanguageModel`, which needs a model object. Because the site renders `__MODEL__` as a gateway string by default, the example a reader sees fails to compile.

**F5. The Anthropic bash-tool example passes a partial sandbox.** `anthropic.mdx:1311` gives `experimental_sandbox` only `description` and `run`. The declared `Experimental_SandboxSession` type also requires `readFile`, `writeFile` and eight more members, so the example fails to compile. The bash tool is experimental, but readers who copy this example need the full session shape.

**F6. Two cookbook recipes narrow tool calls by name, which leaves their inputs untyped.** `55-manual-agent-loop.mdx` checks `toolCall.toolName === 'getWeather'` on `result.toolCalls`, and `56-web-search-agent.mdx` does the same on `toolResults`. Those arrays also hold dynamic tools, whose `toolName` is any string, so the check can't narrow `input` or `output` from `unknown`. `staticToolCalls` and `staticToolResults` narrow correctly, as example 09 shows.

**F7. Three small example errors.** First, the reference examples for `isStepCount` and `hasToolCall`, and the metadata block at `openai.mdx:350`, call `generateText` without a prompt. Second, `openai.mdx` puts its `file_search` case on the wrong switch. The text-annotation switch at line 1994 lists `file_search`, which that union lacks, while the source-document switch at line 2129 omits it from an exhaustive `never` check. Third, the custom `Agent` sketch in `15-agent.mdx` returns partial results that don't satisfy the interface.

**F8. A handful of options are missing from the reference tables.** `experimental_toolApprovalSecret` is missing from the `generateText`, `streamText` and `ToolLoopAgent` tables, although `agents/06-tool-approvals.mdx` documents it. The `ToolLoopAgent` table omits `onLanguageModelCallStart`, `onLanguageModelCallEnd`, `reasoning` and `timeout`, although the settings type accepts all four. The package still exports `stepCountIs`, the older name of `isStepCount`, which the pages no longer mention.

## Verdict: trust the reference tables, and compile examples before you copy them

The AI SDK's reference tables are exact. Every documented option exists, the defaults match, and all fourteen behaviors we tested work as written, including tool approval, stop conditions, structured output and MCP. The examples lag the release in a few places: names from older majors (F1, F3), one missing opt-in (F2), and type-level slips in the provider pages and cookbook (F4–F7). A team can build from the docs if it compiles each copied example against its pinned version, uses `staticToolCalls` for typed tool handling, and reruns `pnpm run verify` at each upgrade.
