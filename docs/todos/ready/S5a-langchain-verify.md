# S5a: LangChain: mirror, verification harness and behavioral examples

| Field | Value |
| --- | --- |
| ID | `S5a` |
| Status | `ready` |
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

- [ ] Research: confirm versions, the docs commit, the in-scope page list, and the fake model's API
- [ ] Create the workspace package, the mirror script and the committed mirror
- [ ] Port extraction and type-checking, keeping only JS variants of mixed-language pages
- [ ] Write the runner on the fake model, with the environment allowlist and network guard (deny host tools by name)
- [ ] Write the API-surface diff for `createAgent`, middleware hooks and `responseFormat`
- [ ] Write behavioral examples: an agent with tools, middleware, human-in-the-loop interrupt and resume, structured output, checkpointer memory, the recursion limit, streaming, and the triage capstone
- [ ] Run `pnpm run verify`, commit `results/`, and push

## Acceptance criteria

- [ ] `pnpm --filter @agent-speak/verify-langchain test` passes offline
- [ ] `pnpm run verify` regenerates every result file
- [ ] Every Tier 1 mismatch is classified
- [ ] Root checks pass

## Tests

`verify/langchain/examples/`.

## Docs to update

Root README; `verify/langchain/README.md`.

## Risks and open questions

The docs repo has no tags matching the package versions, so pages may describe newer releases; record every page that runs ahead of the pinned packages.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
