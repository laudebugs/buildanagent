# S5a: LangChain: mirror, verification harness and behavioral examples

| Field | Value |
| --- | --- |
| ID | `S5a` |
| Status | `done` |
| Plan | [SDK references §4 S5](../../plans/sdk-references.md#s5-langchain-added-2026-11-18) |
| Round / milestone | Round S (SDK references), M2b |
| Depends on | [S4b](../done/S4b-vercel-reference.md) |
| Size | L |

## Goal

Build `verify/langchain/`, the offline harness for LangChain.js v1 agents, and run the first five steps of the SDK process on it.

## Context

- The eight-step process in [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk) and the lessons in the [plan §2](../../plans/sdk-references.md#2-what-s1-and-s2-taught-us)
- The `langchain-ai/docs` repo (MIT, Mintlify MDX, JS and Python mixed)
- The owner's request (2026-11-18): add LangChain after the first four SDKs

## Scope

**In scope**

- Pin `langchain`, `@langchain/core`, `@langchain/langgraph`, `@langchain/anthropic` and `@langchain/openai` exactly
- Mirror the JS agent pages and the LangGraph JS pages they depend on, at a recorded commit, with the license (committed)
- Offline runs on LangChain's own fake chat model, or a scripted `BaseChatModel`
- The API-surface diff and 6–9 behavioral examples, ending with the triage capstone

**Out of scope** (and which todo covers it)

- The guide and fact-check (S5b)
- LangChain Python, LangSmith and LangGraph Platform

## Tasks

- [x] Research: confirm versions, the docs commit, the in-scope page list, and the fake model's API
- [x] Create the workspace package, the mirror script and the committed mirror
- [x] Port extraction and type-checking, keeping only JS variants of mixed-language pages
- [x] Write the runner on the fake model, with the environment allowlist and network guard (deny host tools by name)
- [x] Write the API-surface diff for `createAgent`, middleware hooks and `responseFormat`
- [x] Write behavioral examples: an agent with tools, middleware, human-in-the-loop interrupt and resume, structured output, checkpointer memory, the recursion limit, streaming, and the triage capstone
- [x] Run `pnpm run verify`, commit `results/`, and push

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/verify-langchain test` passes offline
- [x] `pnpm run verify` regenerates every result file
- [x] Every Tier 1 mismatch is classified
- [x] Root checks pass

## Tests

`verify/langchain/examples/`.

## Docs to update

Root README; `verify/langchain/README.md`.

## Risks and open questions

The docs repo has no tags matching the package versions, so pages may describe newer releases; record every page that runs ahead of the pinned packages.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked (this todo's only prose is the harness README; the reference prose is S5b)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- Pinned `langchain@1.6.1`, `@langchain/core@1.3.4`, `@langchain/langgraph@1.6.0`, `@langchain/anthropic@1.6.0`, `@langchain/openai@1.8.0` (the newest published by 2026-11-04; latest on 2026-11-18 is 1.6.6 / 1.4.1 / 1.7.5).
- Mirrored 44 pages and 97 snippets from `langchain-ai/docs@9d9747d` (no tag matches the npm release).
- 713 JS/TS blocks: 219 pass, 361 fragment, 47 syntax, 3 other, 5 ahead of the release, 78 API mismatches grouped by cause in `results/mismatch-causes.json`.
- 68 complete, type-clean blocks run: 20 answered, 13 without a model call, 2 threw as documented, 19 skipped, 14 errors (13 from the uninferable default model id `gpt-6.1-sol`, 12 of which pass when prefixed; 1 missing `thread_id`).
- API diff: the 6 middleware hooks match; 2 documented built-in middleware are missing from the release and 8 exported ones are undocumented; every documented `createAgent` option exists; the recursion default of 25 matches.
- 10 behavioral examples on LangChain's own `fakeModel()` pass offline.
