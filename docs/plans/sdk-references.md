# Plan: a verified reference for every agent SDK, built with one repeatable process (Round S)

- **Status:** In progress (S6 Cloudflare, S7 Google ADK and S8 GitHub Copilot added 2026-11-18)
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): fetch each SDK's docs, build a thorough reference, fact-check the docs, and find a way to verify the examples
- **Builds on:**
  - the [research report](../research/agent-sdks-and-harness-design.md), which chose the SDKs worth studying
  - the eight-step process in [AGENTS.md](../../AGENTS.md#process-for-documenting-an-sdk)
  - the two finished references: [Claude Agent SDK](../reference/claude-agent-sdk/) (S1) and [Pi](../reference/pi/) (S2)
- **Todos:** Round S on the [todo board](../todos/README.md); §5 lists them.

## 1. Goal

Each SDK we might build on, or learn from, gets a reference a developer can trust. Every reference has the same parts, so the comparison in Round C can line them up:
- **A guide** (`docs/reference/<sdk>/guide.md`) that explains how the SDK works and walks through building a gated support-triage agent on it.
- **A fact-check** (`docs/reference/<sdk>/fact-check.md`) that rates the upstream docs in four tiers: type-checks, offline runs, an API-surface diff and behavioral tests.
- **A mirror** of the upstream docs at the pinned release (`docs/reference/<sdk>/source/`), committed when the license allows.
- **A verification harness** (`verify/<sdk>/`), a pnpm workspace package whose `pnpm test` runs offline, with no API key.

## 2. What S1 and S2 taught us

The first two references settled most of the method. These lessons now bind S3 and S4:
- **Mirror from the release, not the live site.** docs.pi.dev/latest rendered Pi's main branch, ahead of the npm release, on six pages. Mirror docs from the git tag that matches the pinned package whenever the docs live in the repo.
- **Prefer the SDK's own test model.** pi-ai's `fauxProvider()` gave cleaner tests than a hand-written HTTP mock. Use the SDK's mock model or model-provider interface first; mock the HTTP API through a base-URL setting only when the loop runs out of process, as Claude's CLI does.
- **Scrub the environment and block the network.** An unscrubbed Pi run sent a doc example to Amazon Bedrock with the host's ambient credentials. Every child process gets an allowlisted environment, and a preload rejects non-local `fetch`.
- **Classify before you report.** Most type errors in docs are fragments, placeholders or harness faults: flattened imports, a missing extension view, pnpm's strict layout. Decide whether the docs, the SDK or the harness is wrong before recording a finding.
- **Verify the claims that matter.** Behavioral examples caught what type-checks can't, such as Claude's permission order, Pi's split-span compaction and `terminate: true`.
- **Review the prose.** The writing review caught a false causal link in the Pi guide that the fact-check missed.

## 3. The process for each SDK

Each SDK takes two todos. The verification todo (a) does steps 1–5 of the [process](../../AGENTS.md#process-for-documenting-an-sdk), and the reference todo (b) does steps 6–8:

| Step | Output |
| --- | --- |
| 1. Research | Pinned versions, license, docs location and format, the SDK's test model or mock seam |
| 2. Mirror | `scripts/fetch-docs.mjs`, `source/` with `_manifest.json` |
| 3. Lay out | `docs/reference/<sdk>/` and the `verify/<sdk>/` workspace package |
| 4. Verify | `extract`, `typecheck:docs`, `run:docs` and `factcheck` scripts, with results in `results/` |
| 5. Behavioral examples | 6–9 programs in `examples/`, ending with the triage-agent capstone |
| 6. Write | `guide.md` and `fact-check.md`, drafted with `/anthropic-skills:writing` |
| 7. Review | `/anthropic-skills:writing-review` on both documents |
| 8. Fix and ship | Fixes applied, changed claims re-checked, `pnpm run verify` green, pushed |

## 4. The eight SDKs

### S1 Claude Agent SDK (done)

`@anthropic-ai/claude-agent-sdk@0.3.327`. The SDK spawns Claude Code's CLI, so the harness mocks the Messages API over HTTP. The docs are © Anthropic, so the mirror is gitignored. Result: 385 blocks type-checked, 87 run, 7 behavioral examples, five findings. See the [fact-check](../reference/claude-agent-sdk/fact-check.md).

### S2 Pi (done)

`@earendil-works/pi-coding-agent@1.5.2`. The loop runs in-process, so the harness uses `fauxProvider()`. MIT-licensed, so the mirror is committed. Result: 334 sources type-checked, 20 run, 8 behavioral examples, six findings (F6 found by the K2 skill test). See the [fact-check](../reference/pi/fact-check.md).

### S3 OpenAI Agents SDK (done)

Result: `@openai/agents@0.21.0`, docs mirrored from tag `v0.21.0`. 182 sources type-checked with no API errors, 66 run on the SDK's own `ScriptedModel`, 9 behavioral examples, five findings. See the [fact-check](../reference/openai-agents-sdk/fact-check.md). The plan below is kept as written.


- **Package:** `@openai/agents` (0.22.0 on 2026-11-18; re-check and pin at the start of S3a), with its sub-packages `@openai/agents-core` and `@openai/agents-openai`.
- **Docs:** the MIT-licensed `openai/openai-agents-js` repo holds them under `docs/src/content/docs/`, about 129 `.md` and `.mdx` pages in an Astro site, plus a runnable `examples/` folder. Mirror both from the release tag, and commit them with the license.
- **Format work:** `.mdx` pages embed code from files with Astro components and imports. The extractor must resolve those embeds to the real files, which also brings the `examples/` folder under test.
- **Test model:** the SDK's `Model` and `ModelProvider` interfaces run the loop in-process. Check for a first-party fake model in the SDK's tests first; otherwise write a scripted `Model`, the equivalent of Pi's faux provider.
- **Behaviors to verify:** handoffs between agents, input and output guardrails that trip a run, function tools with Zod schemas, human-in-the-loop approval (`needsApproval` and resuming from `RunState`), sessions, structured output (`outputType`), `maxTurns`, and tracing hooks. Sandbox agents ship in the Python SDK; record whether the JS SDK has them.
- **Out of scope:** the realtime and voice agents, and the Python SDK. Note them in the guide.

### S4 Vercel AI SDK (done)

Result: `ai@7.0.162`, docs mirrored from tag `ai@7.0.162` (74 pages). 741 blocks type-checked with 12 API mismatches, all reviewed; 116 of 131 complete blocks ran on `MockLanguageModelV4`; 9 behavioral examples; eight findings. Tool approval moved to the call-level `toolApproval` in 7.0, so S4 verified that instead of `needsApproval`. See the [fact-check](../reference/vercel-ai-sdk/fact-check.md). The plan below is kept as written.


- **Package:** `ai` (7.0.176 on 2026-11-18; re-check and pin at the start of S4a), with `@ai-sdk/anthropic` and `@ai-sdk/openai`.
- **Docs:** the Apache-2.0 `vercel/ai` repo holds them under `content/`: 303 docs pages, 164 provider pages and 95 cookbook pages. The owner chose to cover only the agent-relevant core (2026-11-18). That core is AI SDK Core (text generation, tool calling, agents, MCP, streaming and structured output), the Anthropic and OpenAI provider pages, and the cookbook's agent recipes. Mirror and verify those pages, and commit the mirror with the license.
- **Test model:** `ai/test` exports a mock language model; use it for every offline run.
- **Behaviors to verify:** the `Agent` class (`ToolLoopAgent`) and its stop conditions (`stopWhen`, the step cap), tool approval (`needsApproval`), `prepareStep`, structured output, MCP tools, and streaming.
- **Out of scope:** the UI hooks (AI SDK UI and RSC), and providers other than Anthropic and OpenAI.

### S5 LangChain (added 2026-11-18)

The owner asked to add LangChain after the first four were done (2026-11-18).
- **Packages:** `langchain@1.6.1` (its `createAgent` is built on LangGraph), with `@langchain/core@1.3.4`, `@langchain/langgraph@1.6.0`, `@langchain/anthropic@1.6.0` and `@langchain/openai@1.8.0`, all MIT and the newest releases published by 2026-11-04. Re-check the pins at the start of S5a.
- **Docs:** the MIT-licensed `langchain-ai/docs` repo (Mintlify MDX) holds the JS and Python docs side by side. Mirror only the JavaScript pages for LangChain v1 agents and the LangGraph JS pages they depend on, from a commit fetched on the S5a date. Record the commit, because the docs repo has no release tags matching the packages. Commit the mirror with the license.
- **Format work:** pages switch languages with `:::js` / `:::python` blocks or code groups. The extractor must keep only the JS variants.
- **Test model:** check `@langchain/core/utils/testing` for a fake chat model with tool calls first (for example `FakeListChatModel` or `FakeToolCallingModel`); otherwise write a scripted `BaseChatModel`.
- **Behaviors to verify:** `createAgent` with tools, middleware (before/after model, human-in-the-loop approval with `interrupt` and resume), structured output (`responseFormat`), the checkpointer and thread memory, the recursion limit, streaming modes, and MCP tools if the adapter is in scope.
- **Out of scope:** LangChain Python, LangSmith hosting and LangGraph Platform; note them in the guide.

### Language policy: TypeScript references, with a parity check (decided 2026-11-18)

The owner asked whether each SDK should be documented in its primary language. The answer is no. Every reference stays in TypeScript, because our own stack is TypeScript and a reference should cover the package we would import. The primary language still matters as a signal: the TypeScript ports of Python-first SDKs lag their primary. As of November 2026, `@google/adk` is at 2.4.0 against Python `google-adk` 2.14.1, and LangChain's JS docs share pages with Python and run ahead of the npm release. So every reference whose SDK is primarily another language adds a **TypeScript parity** section. That section compares the TS package's features with the primary-language docs, records the gaps in the fact-check, and feeds a "Primary language and TS parity" row in the feature table. S6 and S7 apply this policy from the start. C4 backfills the row for the first five SDKs: Claude (TS and Python, both first-party), Pi (TS only), OpenAI (Python first), Vercel (TS only) and LangChain (Python first).

### S6 Cloudflare Agents (added 2026-11-18)

- **Packages:** `agents@0.33.0` and `@cloudflare/think@0.23.0` (MIT, newest published by 2026-11-04). TypeScript is the primary language.
- **Docs:** `developers.cloudflare.com/agents/` renders from `cloudflare/cloudflare-docs` (CC-BY-4.0 for content; check the license before committing the mirror), and the `cloudflare/agents` repo holds READMEs, docs and examples. Mirror from the release tag where the repo has one.
- **Runtime:** agents are Durable Objects that run on the Workers runtime, so offline runs need Cloudflare's local runtime (`workerd`, through Miniflare or `@cloudflare/vitest-pool-workers`). Allow its build script only through `onlyBuiltDependencies`.
- **Test model:** Think wraps the Vercel AI SDK's `streamText`, so `MockLanguageModelV4` from `ai/test` should drive it; plain `Agent` classes need no model.
- **Behaviors to verify:** Agent state and SQL storage, scheduling, `AIChatAgent`/Think chat loops, tool approval, MCP (client and `McpAgent` server), workflows with human pause and resume, and hibernation-safe state.
- **Out of scope:** deploying to Cloudflare, and paid platform features.

### S7 Google Agent Development Kit (added 2026-11-18)

- **Packages:** `@google/adk` (Apache-2.0; at S7a, pin the newest release at least one week old, following the 2026-11-18 policy change), with `@google/genai` as its model layer. Python is the primary language (`google-adk` 2.14.1 on PyPI), so this reference carries the parity section.
- **Docs:** `google.github.io/adk-docs` renders from `google/adk-docs` (check its license); the `google/adk-js` repo holds the TS source and samples. Mirror the TypeScript pages and samples at a recorded commit or tag.
- **Test model:** look for a first-party fake `BaseLlm` in `@google/adk`; otherwise script one.
- **Behaviors to verify:** `LlmAgent` with function tools, sequential, parallel and loop workflow agents, the graph workflow runtime in 2.x, sessions and state, callbacks (before/after model and tool), structured output, and human-in-the-loop.
- **Out of scope:** Python ADK beyond the parity check, Vertex AI Agent Engine deployment.

### S8 GitHub Copilot SDK (added 2026-11-18)

- **Packages:** `@github/copilot-sdk` (MIT; at S8a, pin the newest release at least one week old), described as a "TypeScript SDK for programmatic control of GitHub Copilot CLI via JSON-RPC". It drives `@github/copilot` (the CLI, 1.0.105 at the cutoff), whose license is GitHub's own ("SEE LICENSE IN LICENSE.md").
- **Shape:** like the Claude Agent SDK, the SDK spawns a CLI that owns the loop, so the harness likely mocks the model API the CLI calls, or the JSON-RPC boundary, rather than an in-process model. Find the CLI's model endpoint override first.
- **Docs:** the `github/copilot-agent-runtime` repo (the SDK's repository field) and GitHub's docs pages. Commit the mirror only if the license allows; otherwise gitignore it, as for Claude.
- **Language:** TypeScript first; record the other official languages, if any, in the parity section.
- **Behaviors to verify:** sessions and resume, custom tools, permission and approval callbacks, MCP servers, streaming events, and the CLI's built-in tools and how to remove them.

### TypeScript gap report (added 2026-11-18)

The owner asked to document, for every SDK whose primary language isn't TypeScript, what the TypeScript SDK is missing. Todo C5 writes `docs/comparison/typescript-gaps.md`. For each SDK it lists the features in the primary-language SDK that the TypeScript package lacks, has only in a weaker form, or documents only for the primary language. Each gap cites the primary-language docs or source, at a recorded version, and the TypeScript package's `.d.ts` that shows the absence. The report covers OpenAI Agents (Python first), LangChain (Python first), Google ADK (Python first), and the Claude Agent SDK's Python package, plus Copilot if it has other official SDKs. Each reference's fact-check then gains a short parity section that links to the report.

## 5. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| S1 | Claude Agent SDK reference | done |
| S2 | Pi reference | done |
| S3a | OpenAI Agents SDK: mirror, verification harness and behavioral examples (done) | S2 |
| S3b | OpenAI Agents SDK: guide and fact-check, written and reviewed (done) | S3a |
| S4a | Vercel AI SDK: mirror, verification harness and behavioral examples (done) | S3b |
| S4b | Vercel AI SDK: guide and fact-check, written and reviewed (done) | S4a |
| S5a | LangChain: mirror, verification harness and behavioral examples (done) | S4b |
| S5b | LangChain: guide and fact-check, written and reviewed (done) | S5a |
| S6a | Cloudflare Agents: mirror, verification harness and behavioral examples (done) | S5b |
| S6b | Cloudflare Agents: guide and fact-check, written and reviewed | S6a |
| S7a | Google ADK: mirror, verification harness, behavioral examples and TS parity check | S6b |
| S7b | Google ADK: guide and fact-check, written and reviewed | S7a |
| S8a | GitHub Copilot SDK: mirror, verification harness and behavioral examples | S7b |
| S8b | GitHub Copilot SDK: guide and fact-check, written and reviewed | S8a |

## 6. Risks

- **MDX embeds.** If the OpenAI docs import code through Astro components the extractor can't resolve, Tier 1 undercounts. Mitigation: resolve `import … from '…?raw'`-style embeds to files, and report any block the extractor can't place.
- **No first-party test model.** If an SDK lacks one, a hand-written mock can drift from real provider behavior. Mitigation: keep the mock minimal, and mark claims it proves as verified only for the loop, not for the provider.
- **Docs ahead of the release.** As with Pi, a docs site may render unreleased changes. Mitigation: mirror from the tag, and record any pages that differ.

## 7. Open questions

- Should the live smoke-test suite (real API calls, capped on turns and spend) join Round S, or wait until the owner provides API keys? Current answer: wait; the owner chose offline first (2026-11-18).
