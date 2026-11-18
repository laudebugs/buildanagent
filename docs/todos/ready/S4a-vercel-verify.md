# S4a: Vercel AI SDK: mirror, verification harness and behavioral examples

| Field | Value |
| --- | --- |
| ID | `S4a` |
| Status | `ready` |
| Plan | [SDK references §4 S4](../../plans/sdk-references.md#s4-vercel-ai-sdk) |
| Round / milestone | Round S (SDK references), M1 |
| Depends on | [S3b](../ready/S3b-openai-reference.md) |
| Size | L |

## Goal

Build `verify/vercel-ai-sdk/`, the offline harness for the `ai` package, covering the agent-relevant core the owner chose, and run the first five steps of the SDK process on it.

## Context

- the eight-step process in [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk) and its lessons in the [plan §2](../../plans/sdk-references.md#2-what-s1-and-s2-taught-us)
- The upstream repo `vercel/ai`: `content/docs`, `content/providers` and `content/cookbook` (MDX), Apache-2.0
- The owner's scope decision (2026-11-18): AI SDK Core, agents, tools, MCP, streaming and structured output; the Anthropic and OpenAI providers; the agent cookbook recipes

## Scope

**In scope**

- Pin `ai`, `@ai-sdk/anthropic` and `@ai-sdk/openai` exactly
- Mirror the in-scope pages from the release tag, with the license (committed)
- Offline runs on the mock language model from `ai/test`
- The API-surface diff and 6–9 behavioral examples, ending with the triage capstone

**Out of scope** (and which todo covers it)

- The guide and fact-check (S4b)
- AI SDK UI and RSC, and providers other than Anthropic and OpenAI

## Tasks

- [ ] Research: confirm versions, the release tag, the in-scope page list, and the mock model's API
- [ ] Create the workspace package, the mirror script and the committed mirror
- [ ] Port extraction and type-checking; resolve MDX embeds
- [ ] Write the runner on the mock model, with the environment allowlist and network guard
- [ ] Write the API-surface diff for `generateText`, `streamText`, `tool`, the `Agent` class and its stop conditions
- [ ] Write behavioral examples: generate text, a tool loop with `stopWhen`, tool approval, `prepareStep`, structured output, an MCP tool, streaming, and the triage capstone
- [ ] Run `pnpm run verify`, commit `results/`, and push

## Acceptance criteria

- [ ] `pnpm --filter @agent-speak/verify-vercel-ai-sdk test` passes offline
- [ ] `pnpm run verify` regenerates every result file
- [ ] Every Tier 1 mismatch is classified
- [ ] Root checks pass

## Tests

`verify/vercel-ai-sdk/examples/`.

## Docs to update

Root README; `verify/vercel-ai-sdk/README.md`.

## Risks and open questions

The in-scope page list may still be large; record the exact list in the mirror manifest.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
